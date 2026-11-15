const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const { spawn } = require('node:child_process');
const { createRegistry, DEFAULT_MAX_AGE_MS } = require('../src/process-registry');

const fakeChild = (pid) => Object.assign(new EventEmitter(), { pid });

test('tracked processes are forgotten when they exit, close or fail', () => {
  const registry = createRegistry({ kill: () => {} });
  const a = registry.track(fakeChild(1), { label: 'ffmpeg' });
  const b = registry.track(fakeChild(2));
  const c = registry.track(fakeChild(3));
  assert.equal(registry.count(), 3);
  a.emit('close');
  b.emit('exit');
  c.emit('error', new Error('spawn failed'));
  assert.equal(registry.count(), 0);
});

test('track() returns the same child and ignores children that never started (no pid)', () => {
  const registry = createRegistry({ kill: () => {} });
  const child = fakeChild(5);
  assert.equal(registry.track(child), child);
  const failed = fakeChild(undefined);
  assert.equal(registry.track(failed), failed);
  assert.equal(registry.track(null), null);
  assert.equal(registry.count(), 1);
});

test('killAll kills every tracked child once and empties the registry', () => {
  const killed = [];
  const registry = createRegistry({ kill: (child) => killed.push(child.pid) });
  registry.track(fakeChild(10)); registry.track(fakeChild(11)); registry.track(fakeChild(12));
  assert.equal(registry.killAll(), 3);
  assert.deepEqual(killed.sort(), [10, 11, 12]);
  assert.equal(registry.count(), 0);
  assert.equal(registry.killAll(), 0);
});

test('sweep kills only processes older than their own maximum age; Infinity (radio) is never swept', () => {
  let clock = 0;
  const killed = [];
  const registry = createRegistry({ kill: (child) => killed.push(child.pid), now: () => clock });
  registry.track(fakeChild(1), { label: 'yt-dlp', maxAgeMs: 5 * 60_000 });
  registry.track(fakeChild(2), { label: 'ffmpeg' }); // default: longer than any allowed song
  registry.track(fakeChild(3), { label: 'ffmpeg (radio)', maxAgeMs: Infinity });
  clock = 4 * 60_000;
  assert.deepEqual(registry.sweep(), []);
  clock = 6 * 60_000;
  assert.deepEqual(registry.sweep().map((k) => [k.pid, k.label]), [[1, 'yt-dlp']]);
  clock = DEFAULT_MAX_AGE_MS + 1000;
  assert.deepEqual(registry.sweep().map((k) => k.pid), [2]);
  clock = 1e15;
  assert.deepEqual(registry.sweep(), [], 'only the radio is left and it is exempt');
  assert.deepEqual(killed, [1, 2]);
  assert.deepEqual(registry.snapshot().map((s) => s.pid), [3]);
});

test('REAL process: killAll really terminates a running child (default killer, incl. process tree on Windows)', async () => {
  const registry = createRegistry();
  const child = registry.track(spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }), { label: 'sleeper' });
  assert.ok(child.pid);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(child.exitCode, null, 'running');
  const closed = new Promise((resolve) => child.once('close', resolve));
  assert.equal(registry.killAll(), 1);
  await Promise.race([closed, new Promise((_, reject) => setTimeout(() => reject(new Error('child still running after killAll')), 5000))]);
  assert.equal(registry.count(), 0);
});

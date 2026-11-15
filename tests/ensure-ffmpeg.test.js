const test = require('node:test');
const assert = require('node:assert/strict');
const { ensureFfmpeg } = require('../src/ensure-ffmpeg');

test('does nothing when the binary exists', () => {
  let ran = false;
  assert.equal(ensureFfmpeg({ resolvePath: () => '/x/ffmpeg', existsSync: () => true, run: () => { ran = true; } }), true);
  assert.equal(ran, false);
});

test('runs the download script when the binary is missing and reports the result', () => {
  let present = false; const calls = [];
  const ok = ensureFfmpeg({ resolvePath: () => '/x/ffmpeg', resolveDir: () => '/x', existsSync: () => present, run: (...args) => { calls.push(args); present = true; } });
  assert.equal(ok, true);
  assert.deepEqual(calls[0][1], ['install.js']);
  assert.equal(calls[0][2].cwd, '/x');
});

test('still false when the download did not help or the package is unusable', () => {
  assert.equal(ensureFfmpeg({ resolvePath: () => '/x/ffmpeg', resolveDir: () => '/x', existsSync: () => false, run: () => {} }), false);
  assert.equal(ensureFfmpeg({ resolvePath: () => { throw new Error('nope'); } }), false);
  assert.equal(ensureFfmpeg({ resolvePath: () => '/x/ffmpeg', resolveDir: () => { throw new Error('boom'); }, existsSync: () => false }), false);
});

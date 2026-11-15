const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createFileSink, fileLogOptions, DEFAULT_MAX_BYTES } = require('../src/log-file');
const { createErrorAlerts, createOwnerDm, errorKey } = require('../src/error-alerts');
const admin = require('../src/commands/admin');

const tempDir = () => fs.mkdtemp(path.join(os.tmpdir(), 'logtest-'));

test('file sink appends lines (newline-terminated) and creates missing folders', async () => {
  const dir = await tempDir();
  const file = path.join(dir, 'deep', 'bot.log');
  const sink = createFileSink({ filePath: file });
  sink.write('first');
  sink.write('second\n');
  await sink.flush();
  assert.equal(await fs.readFile(file, 'utf8'), 'first\nsecond\n');
  await fs.rm(dir, { recursive: true, force: true });
});

test('rotation keeps the newest lines, shifts older files, and caps disk use at keep+1 files', async () => {
  const dir = await tempDir();
  const file = path.join(dir, 'bot.log');
  const sink = createFileSink({ filePath: file, maxBytes: 100, keep: 2 });
  for (let n = 1; n <= 30; n++) sink.write(`line-${String(n).padStart(2, '0')}-${'x'.repeat(20)}`); // 30 bytes each
  await sink.flush();
  const names = (await fs.readdir(dir)).sort();
  assert.deepEqual(names, ['bot.log', 'bot.log.1', 'bot.log.2'], 'never more than keep + current');
  for (const name of names) assert.ok((await fs.stat(path.join(dir, name))).size <= 100, `${name} stays under the cap`);
  const newest = (await fs.readFile(file, 'utf8')).trim().split('\n');
  assert.match(newest.at(-1), /^line-30/);
  assert.equal((await fs.readFile(path.join(dir, 'bot.log.2'), 'utf8')).includes('line-01'), false, 'the oldest lines were dropped');
  await fs.rm(dir, { recursive: true, force: true });
});

test('an existing log is continued (size is read from disk) and tail() spans rotated files', async () => {
  const dir = await tempDir();
  const file = path.join(dir, 'bot.log');
  await fs.writeFile(file, `${'old'.repeat(10)}\n`);
  const sink = createFileSink({ filePath: file, maxBytes: 60, keep: 2 });
  sink.write('a'.repeat(20));
  sink.write('b'.repeat(20)); // pushes past 60 bytes: rotates
  await sink.flush();
  assert.ok((await fs.readdir(dir)).includes('bot.log.1'));
  const lines = await sink.tail(10);
  assert.equal(lines.at(-1), 'b'.repeat(20));
  assert.ok(lines.includes('old'.repeat(10)), 'older rotated content is included');
  assert.deepEqual(await sink.tail(1), ['b'.repeat(20)]);
  assert.deepEqual(await createFileSink({ filePath: path.join(dir, 'missing.log') }).tail(5), []);
  await fs.rm(dir, { recursive: true, force: true });
});

test('a broken disk never throws into the bot', async () => {
  const broken = { mkdir: async () => { throw new Error('disk full'); }, stat: async () => { throw new Error('x'); }, appendFile: async () => {}, rm: async () => {}, rename: async () => {}, readFile: async () => { throw new Error('x'); } };
  const sink = createFileSink({ filePath: '/nope/bot.log', files: broken });
  await sink.write('line');
  await sink.write('another');
  assert.equal(sink.failures, 2);
  assert.deepEqual(await sink.tail(5), []);
});

test('environment options: default path, off switch, sizes and keep are validated', () => {
  const base = path.join(os.tmpdir(), 'proj');
  assert.equal(fileLogOptions({}, base).filePath, path.join(base, 'data', 'logs', 'bot.log'));
  assert.equal(fileLogOptions({ LOG_FILE: 'off' }, base), null);
  assert.equal(fileLogOptions({ LOG_FILE: 'OFF' }, base), null);
  assert.equal(fileLogOptions({}, base).maxBytes, DEFAULT_MAX_BYTES);
  const custom = fileLogOptions({ LOG_FILE: 'logs/x.log', LOG_MAX_MB: '0.5', LOG_KEEP: '5' }, base);
  assert.deepEqual([custom.filePath, custom.maxBytes, custom.keep], [path.join(base, 'logs', 'x.log'), 524288, 5]);
  assert.equal(fileLogOptions({ LOG_MAX_MB: '-3', LOG_KEEP: '999' }, base).keep, 3);
  assert.equal(fileLogOptions({ LOG_MAX_MB: 'abc' }, base).maxBytes, DEFAULT_MAX_BYTES);
});

test('log listeners receive each emitted line, can be removed, and cannot break logging', () => {
  const script = `
    const log = require('./src/log');
    const seen = [];
    const off = log.addListener(({ level, line }) => seen.push(level + ':' + line.split(' ').slice(1).join(' ')));
    log.addListener(() => { throw new Error('bad listener'); });
    log.debug('hidden'); log.info('one'); log.error('two');
    off(); log.info('three');
    console.error(JSON.stringify(seen));`;
  const result = spawnSync(process.execPath, ['-e', script], { cwd: process.cwd(), env: { ...process.env, LOG_LEVEL: 'info' }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stderr.trim().split('\n').pop()), ['info:INFO one', 'error:ERROR two']);
});

// ---- owner alerts ----
test('errorKey groups the same problem with different ids, numbers and quoted names', () => {
  assert.equal(errorKey('Failed to play "Song A" in guild 123456'), errorKey('Failed to play "Other" in guild 987'));
  assert.notEqual(errorKey('Failed to play'), errorKey('Failed to join'));
  assert.equal(errorKey('first line\nstack trace line 2'), 'first line');
  assert.equal(errorKey(''), '');
});

function alertHarness(options = {}) {
  let clock = 1_000_000;
  const sent = [];
  const alerts = createErrorAlerts({ send: (text) => sent.push(text), now: () => clock, ...options });
  return { alerts, sent, advance: (ms) => { clock += ms; }, line: (text) => ({ line: `2026-01-01T00:00:00.000Z ERROR ${text}` }) };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('one stray error is ignored; the same error 3× in 10 minutes alerts the owner once, then waits out a cooldown', async () => {
  const h = alertHarness();
  assert.equal(h.alerts.record(h.line('Playback error: 403 for guild 111')), false);
  h.advance(60_000);
  assert.equal(h.alerts.record(h.line('Playback error: 403 for guild 222')), false);
  h.advance(60_000);
  assert.equal(h.alerts.record(h.line('Playback error: 403 for guild 333')), true);
  await tick();
  assert.equal(h.sent.length, 1);
  assert.match(h.sent[0], /same error happened 3× in 10 minutes/);
  assert.match(h.sent[0], /Playback error: 403/);
  assert.equal(h.sent[0].includes('2026-01-01T00'), false, 'the timestamp prefix is stripped');
  for (let n = 0; n < 5; n++) { h.advance(1000); assert.equal(h.alerts.record(h.line('Playback error: 403 for guild 9')), false); }
  h.advance(31 * 60_000);
  [1, 2, 3].forEach(() => h.alerts.record(h.line('Playback error: 403 for guild 1')));
  await tick();
  assert.equal(h.sent.length, 2, 'alerts again after the cooldown');
});

test('errors spread over more than the window do not add up', async () => {
  const h = alertHarness();
  for (let n = 0; n < 6; n++) { h.alerts.record(h.line('slow drip')); h.advance(6 * 60_000); }
  await tick();
  assert.equal(h.sent.length, 0);
});

test('many different errors trigger one combined alert', async () => {
  const h = alertHarness({ totalThreshold: 6 });
  for (let n = 0; n < 6; n++) { h.alerts.record(h.line(`distinct failure kind-${'x'.repeat(n + 1)}`)); h.advance(1000); }
  await tick();
  assert.equal(h.sent.length, 1);
  assert.match(h.sent[0], /6 errors in 10 minutes\*\* \(different kinds\)/);
});

test('a failing sender never throws into the bot, and unrelated text is handled', async () => {
  const h = alertHarness({ send: () => { throw new Error('dm failed'); }, threshold: 1 });
  assert.equal(h.alerts.record(h.line('boom')), true);
  await tick();
  assert.equal(h.alerts.record({ line: '' }), false);
  assert.equal(h.alerts.record(undefined), false);
});

test('owner DM goes to every owner and survives closed DMs / unknown users', async () => {
  const delivered = [];
  const client = { users: { fetch: async (id) => {
    if (id === '2') throw new Error('Unknown User');
    return { send: async (text) => { if (id === '3') throw new Error('Cannot send messages to this user'); delivered.push([id, text]); } };
  } } };
  await createOwnerDm(client, ['1', '2', '3', '4'])('hello');
  assert.deepEqual(delivered, [['1', 'hello'], ['4', 'hello']]);
});

test('/admin logs output keeps the newest lines inside one Discord message and cannot break out of its code block', () => {
  assert.equal(admin.fitLog(['a', 'b']), 'a\nb');
  const long = Array.from({ length: 200 }, (_, n) => `line ${n} ${'x'.repeat(40)}`);
  const fitted = admin.fitLog(long);
  assert.ok(fitted.length <= 1850 + 1);
  assert.ok(fitted.startsWith('…'));
  assert.ok(fitted.endsWith('line 199 ' + 'x'.repeat(40)), 'newest line is kept');
  assert.equal(admin.fitLog(['danger ``` inside']).includes('```'), false);
});

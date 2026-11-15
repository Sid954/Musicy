const test = require('node:test');
const assert = require('node:assert/strict');
const { jsRuntimeMode, extractAudio, getHealth } = require('../src/music/sources/youtube');

const INFO = JSON.stringify({ id: 'abc', title: 'T', duration: 10, url: 'https://cdn.example/a', acodec: 'opus' });
const failure = (code, message = 'boom') => Object.assign(new Error(message), code ? { code } : {});

test('YTDLP_JS_RUNTIME accepts auto/always/off and falls back to auto', () => {
  assert.equal(jsRuntimeMode(undefined), 'auto');
  assert.equal(jsRuntimeMode('ALWAYS'), 'always');
  assert.equal(jsRuntimeMode('off'), 'off');
  assert.equal(jsRuntimeMode('deno-please'), 'auto');
});

test('auto: the first attempt has NO js runtime (faster); an unexplained failure retries once WITH node', async () => {
  const calls = [];
  const before = getHealth().jsRuntimeRetries;
  const runner = async (args) => {
    calls.push(args);
    if (!args.includes('--js-runtimes')) throw failure('UNKNOWN');
    return `${INFO}\n`;
  };
  const info = await extractAudio('ytsearch1:x', { runner, mode: 'auto' });
  assert.equal(info.title, 'T');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].includes('--js-runtimes'), false);
  const flag = calls[1].indexOf('--js-runtimes');
  assert.equal(calls[1][flag + 1], `node:${process.execPath}`);
  assert.equal(getHealth().jsRuntimeRetries, before + 1);
});

test('auto: a working first attempt never launches the runtime', async () => {
  const calls = [];
  await extractAudio('x', { runner: async (args) => { calls.push(args); return INFO; }, mode: 'auto' });
  assert.equal(calls.length, 1);
});

test('known failures, cancellations and empty results are final (no retry)', async () => {
  for (const error of [failure('BOT_CHECK'), failure('UNAVAILABLE'), failure('AGE_RESTRICTED'), failure(undefined, 'No results found.')]) {
    let calls = 0;
    await assert.rejects(extractAudio('x', { runner: async () => { calls++; throw error; }, mode: 'auto' }), (e) => e === error);
    assert.equal(calls, 1, `${error.code || error.message} must not retry`);
  }
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(extractAudio('x', { signal: controller.signal, runner: async () => { calls++; throw failure('UNKNOWN'); }, mode: 'auto' }));
  assert.equal(calls, 1);
});

test('if the retry also fails the ORIGINAL friendly error is reported', async () => {
  const original = failure('UNKNOWN', 'original');
  let calls = 0;
  await assert.rejects(extractAudio('x', { runner: async () => { calls++; throw calls === 1 ? original : failure('UNKNOWN', 'second'); }, mode: 'auto' }), (e) => e === original);
  assert.equal(calls, 2);
});

test('off never uses the runtime; always uses it from the start', async () => {
  let calls = 0;
  await assert.rejects(extractAudio('x', { runner: async () => { calls++; throw failure('UNKNOWN'); }, mode: 'off' }));
  assert.equal(calls, 1);
  const seen = [];
  await extractAudio('x', { runner: async (args) => { seen.push(args.includes('--js-runtimes')); return INFO; }, mode: 'always' });
  assert.deepEqual(seen, [true]);
});

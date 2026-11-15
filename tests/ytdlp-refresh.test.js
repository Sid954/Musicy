const test = require('node:test');
const assert = require('node:assert/strict');
const { createYtdlpRefresher } = require('../src/music/ytdlp-refresh');

test('yt-dlp refresh is rate-limited and concurrent failures share one update', async () => {
  let now = 0;
  let calls = 0;
  const refresh = createYtdlpRefresher({ now: () => now, cooldownMs: 60_000 });
  let release;
  const update = () => { calls++; return new Promise((resolve) => { release = resolve; }); };
  const first = refresh(update);
  const second = refresh(update);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  release();
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(await refresh(update), false);
  now += 60_000;
  assert.equal(await refresh(async () => { calls++; }), true);
  assert.equal(calls, 2);
});

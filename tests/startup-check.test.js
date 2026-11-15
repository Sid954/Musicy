const test = require('node:test');
const assert = require('node:assert/strict');
const { runSelfTest, summarize } = require('../src/selftest');
const { runStartupChecks, hasErrors, formatReport, looksLikeBotToken } = require('../src/startup-check');

const TOKEN = `${'A'.repeat(24)}.${'b'.repeat(6)}.${'c'.repeat(27)}`;
const goodEnv = { DISCORD_TOKEN: TOKEN, CLIENT_ID: '123456789012345678' };
const healthy = (overrides = {}) => runStartupChecks({
  env: goodEnv, nodeVersion: '22.1.0', existsSync: () => true, ffmpegPath: '/x/ffmpeg', ytdlpPath: '/x/yt-dlp',
  canWriteDir: () => true, hasModule: () => true, voiceVersion: () => '0.19.2', ...overrides,
});
const by = (results, name) => results.find((r) => r.name === name);

test('REGRESSION: the real installed voice library and DAVE are recognised (no false "missing" error)', () => {
  const results = runStartupChecks({ env: goodEnv, canWriteDir: () => true });
  assert.equal(by(results, 'Voice encryption')?.level, 'ok', formatReport(results));
  assert.equal(hasErrors(results.filter((r) => r.name !== 'ffmpeg')), false);
});

test('a healthy setup has no errors or warnings', () => {
  const results = healthy();
  assert.equal(results.filter((r) => r.level === 'error' || r.level === 'warn').length, 0, formatReport(results));
  assert.ok(results.every((r) => r.name && r.message));
});

test('errors: old Node, missing token, old voice library, missing DAVE, missing ffmpeg', () => {
  assert.equal(by(healthy({ nodeVersion: '16.20.0' }), 'Node.js').level, 'error');
  assert.equal(by(healthy({ env: {} }), 'Discord token').level, 'error');
  assert.match(by(healthy({ voiceVersion: () => '0.18.0' }), 'Voice library').message, /0\.19 or newer/);
  assert.equal(by(healthy({ voiceVersion: () => undefined }), 'Voice library').level, 'error');
  assert.match(by(healthy({ hasModule: () => false }), 'Voice encryption').message, /DAVE library .* missing/);
  assert.equal(by(healthy({ existsSync: () => false }), 'ffmpeg').level, 'error');
  assert.equal(hasErrors(healthy({ env: {} })), true);
  assert.equal(hasErrors(healthy()), false);
});

test('warnings: odd token, no client id, no yt-dlp yet, missing cookies file, bad optional values, unwritable data', () => {
  assert.equal(by(healthy({ env: { ...goodEnv, DISCORD_TOKEN: 'abc' } }), 'Discord token').level, 'warn');
  assert.equal(by(healthy({ env: { DISCORD_TOKEN: TOKEN } }), 'Client ID').level, 'warn');
  assert.match(by(healthy({ existsSync: (p) => !p.includes('yt-dlp') }), 'yt-dlp').message, /fetched automatically/);
  const cookies = healthy({ env: { ...goodEnv, YTDLP_COOKIES: 'cookies.txt' }, existsSync: (p) => !p.includes('cookies') });
  assert.equal(by(cookies, 'YouTube cookies').level, 'warn');
  assert.equal(by(healthy({ env: { ...goodEnv, BOT_OWNER_ID: 'me' } }), 'Owner').level, 'warn');
  assert.equal(by(healthy({ env: { ...goodEnv, BOT_OWNER_ID: '111111111111111111, 222222222222222222' } }), 'Owner').level, 'ok');
  for (const [key, value, name] of [['MEMORY_LIMIT_MB', 'lots', 'Memory limit'], ['LOG_LEVEL', 'loud', 'Log level'], ['YTDLP_JS_RUNTIME', 'maybe', 'yt-dlp runtime']]) {
    assert.equal(by(healthy({ env: { ...goodEnv, [key]: value } }), name).level, 'warn', name);
  }
  assert.equal(by(healthy({ canWriteDir: () => false }), 'Data folder').level, 'warn');
});

test('the token is never printed in any message', () => {
  const text = formatReport(healthy());
  assert.equal(text.includes(TOKEN), false);
  assert.equal(formatReport(healthy({ env: { ...goodEnv, DISCORD_TOKEN: 'secret-token-value' } })).includes('secret-token-value'), false);
  assert.equal(looksLikeBotToken(TOKEN), true);
  assert.equal(looksLikeBotToken('a.b.c'), false);
});

// ---- live self-test with injected runners ----
const fakeEnv = { ...goodEnv, MEMORY_LIMIT_MB: '512' };
const base = {
  env: fakeEnv, startup: () => [], ffmpegPath: 'ffmpeg', ytdlpPath: 'yt-dlp',
  run: async (file) => (file === 'yt-dlp' ? '2026.1.1\n' : 'OGG'), lookup: async () => ({}),
  resolveVideo: async () => [{ title: 'x' }], memory: () => 100 * 1048576, readHelpers: async () => [{ name: 'ffmpeg', pid: 1, kb: 20480 }],
};
const level = (results, name) => results.find((r) => r.name === name)?.level;

test('self-test: all green when everything works', async () => {
  const results = await runSelfTest(base);
  assert.deepEqual(summarize(results), { errors: 0, warnings: 0, ok: results.length });
  assert.match(results.find((r) => r.name === 'Memory').message, /Total ≈ 120 MB of 512 MB/);
});

test('self-test: reports each failure separately and explains a YouTube bot check', async () => {
  const results = await runSelfTest({
    ...base,
    run: async () => { throw new Error('spawn ENOENT'); },
    lookup: async (host) => { if (host.includes('youtube')) throw Object.assign(new Error('x'), { code: 'ENOTFOUND' }); return {}; },
    resolveVideo: async () => { throw Object.assign(new Error('Sign in to confirm'), { code: 'BOT_CHECK' }); },
    readHelpers: async () => { throw new Error('no access'); },
  });
  assert.equal(level(results, 'yt-dlp runs'), 'error');
  assert.equal(level(results, 'ffmpeg encodes Opus'), 'error');
  assert.equal(level(results, 'Network: discord.com'), 'ok');
  assert.match(results.find((r) => r.name === 'Network: www.youtube.com').message, /ENOTFOUND/);
  assert.match(results.find((r) => r.name === 'YouTube lookup').message, /YTDLP_COOKIES/);
  assert.match(results.find((r) => r.name === 'Memory').message, /cannot be read/);
  assert.equal(summarize(results).errors, 4);
});

test('self-test: appends caller-provided results (e.g. Discord ping) and flags a very slow lookup', async () => {
  const results = await runSelfTest({ ...base, extra: [{ level: 'ok', name: 'Discord', message: 'ping 42 ms' }] });
  assert.equal(results.at(-1).name, 'Discord');
  const originalNow = Date.now;
  let tick = 0;
  Date.now = () => (tick += 20_000);
  try {
    const slow = await runSelfTest(base);
    assert.equal(level(slow, 'YouTube lookup'), 'warn');
  } finally { Date.now = originalNow; }
});

test('REGRESSION: a damaged discord.js install (a deleted file) is reported at startup, not as a crash later', () => {
  const damaged = healthy({ loadDiscord: () => { throw new Error("Cannot find module './GuildChannelsPositionUpdate.js'\nRequire stack:\n- ..."); } });
  const result = by(damaged, 'discord.js');
  assert.equal(result.level, 'error');
  assert.match(result.message, /installation is damaged \(Cannot find module '\.\/GuildChannelsPositionUpdate\.js'\)/);
  assert.equal(result.message.includes('Require stack'), false, 'only the first line of the error is shown');
  assert.match(result.message, /npm install/);
  assert.equal(hasErrors(damaged), true);
  assert.equal(by(healthy(), 'discord.js').level, 'ok');
});

test('the real installed discord.js passes the probe (creates a Client without connecting)', () => {
  const results = runStartupChecks({ env: goodEnv, canWriteDir: () => true });
  assert.equal(by(results, 'discord.js').level, 'ok', formatReport(results));
});

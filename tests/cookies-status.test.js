const test = require('node:test');
const assert = require('node:assert/strict');
const { describeCookies, parseOwnerIds, ago } = require('../src/music/cookies-status');
const youtube = require('../src/music/sources/youtube');

const NOW = Date.UTC(2026, 10, 15);
const DAY = 86_400_000;
const text = (state) => describeCookies(state, NOW);

test('ago renders minutes, hours and days', () => {
  assert.equal(ago(10_000), 'just now');
  assert.equal(ago(5 * 60_000), '5 min ago');
  assert.equal(ago(3 * 3_600_000), '3 h ago');
  assert.equal(ago(5 * DAY), '5 days ago');
});

test('owner ids are parsed from a comma/space separated list and junk is ignored', () => {
  assert.deepEqual(parseOwnerIds('123456789012345678, 987654321098765432'), ['123456789012345678', '987654321098765432']);
  assert.deepEqual(parseOwnerIds('abc 12 '), []);
  assert.deepEqual(parseOwnerIds(undefined), []);
});

test('healthy: no cookies needed and no sign-in requests -> no hint', () => {
  const r = text({ configured: false });
  assert.match(r.lines.join('\n'), /not configured/);
  assert.match(r.lines.join('\n'), /none since the bot started/);
  assert.equal(r.hint, undefined);
});

test('blocked host without cookies tells you how to fix it', () => {
  const r = text({ configured: false, botCheckCount: 3, lastBotCheckAt: NOW - 120_000 });
  assert.match(r.lines.join('\n'), /3 since start · last 2 min ago/);
  assert.match(r.hint, /throwaway YouTube account/);
});

test('configured but missing file points at the path', () => {
  const r = text({ configured: true, exists: false });
  assert.match(r.lines[0], /not found/);
  assert.match(r.hint, /YTDLP_COOKIES/);
});

test('fresh cookies and no problems -> no hint; old cookies are flagged as stale', () => {
  assert.equal(text({ configured: true, exists: true, mtimeMs: NOW - 2 * DAY }).hint, undefined);
  const stale = text({ configured: true, exists: true, mtimeMs: NOW - 45 * DAY });
  assert.match(stale.hint, /45 days old/);
});

test('sign-in requests AFTER the cookies were saved mean the cookies did not help', () => {
  const r = text({ configured: true, exists: true, mtimeMs: NOW - 3 * DAY, botCheckCount: 1, lastBotCheckAt: NOW - 1000 });
  assert.match(r.hint, /still asked to sign in/);
  const before = text({ configured: true, exists: true, mtimeMs: NOW - 1000, botCheckCount: 1, lastBotCheckAt: NOW - 3 * DAY });
  assert.equal(before.hint, undefined, 'the request predates the new cookie file');
});

test('youtube health counts BOT_CHECK errors only', () => {
  const before = youtube.getHealth();
  youtube.classifyYtdlpError('ERROR: Sign in to confirm you are not a bot'); // classification alone does not count
  assert.equal(youtube.getHealth().botCheckCount, before.botCheckCount);
  assert.equal(typeof youtube.getHealth().lastBotCheckAt, 'number');
});

test('a lookup that succeeded after the last sign-in request means the cookies work now', () => {
  const now = 10 * 60 * 60 * 1000;
  const base = { configured: true, exists: true, mtimeMs: now - 3_600_000, lastBotCheckAt: now - 3_000_000, botCheckCount: 4 };
  const failing = describeCookies({ ...base, lastOkAt: 0 }, now);
  assert.match(failing.hint, /still asked to sign in/);
  const working = describeCookies({ ...base, lastOkAt: now - 600_000 }, now);
  assert.match(working.hint, /look \*\*fine now\*\*/);
  assert.ok(working.lines.some((line) => /Last successful lookup:\*\* 10 min ago/.test(line)));
  assert.doesNotMatch(working.hint, /still asked/);
});

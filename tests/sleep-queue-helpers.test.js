const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { clampMinutes, formatRemaining, describeSleep, MAX_SLEEP_MINUTES } = require('../src/music/sleep');
const { dedupeQueue, findQueuePosition } = require('../src/music/collection');

test('sleep helpers clamp minutes and describe the timer', () => {
  assert.equal(clampMinutes(30), 30);
  assert.equal(clampMinutes(99999), MAX_SLEEP_MINUTES);
  assert.equal(clampMinutes('15'), 15);
  assert.throws(() => clampMinutes(0), RangeError);
  assert.throws(() => clampMinutes('abc'), RangeError);
  assert.equal(formatRemaining(30_000), '1m');
  assert.equal(formatRemaining(90 * 60_000), '1h 30m');
  const now = 1_000_000;
  assert.equal(describeSleep({ sleepAt: now + 12 * 60_000 }, now), '😴 Sleep in 12m');
  assert.equal(describeSleep({ afterTrack: true }, now), '😴 Sleep after this track');
  assert.equal(describeSleep({ sleepAt: now - 1 }, now), null);
  assert.equal(describeSleep({}, now), null);
});

test('dedupeQueue keeps the first copy and treats the playing track as taken', () => {
  const t = (id) => ({ title: id, url: `https://youtu.be/${id}0000` });
  const queue = [t('a'), t('b'), t('a'), t('c'), t('b'), t('d')];
  const result = dedupeQueue(queue, t('c'));
  assert.deepEqual(result.kept.map((x) => x.title), ['a', 'b', 'd']);
  assert.equal(result.removed, 3);
  assert.deepEqual(dedupeQueue([], null), { kept: [], removed: 0 });
});

test('findQueuePosition returns the 1-based position of the first title match', () => {
  const tracks = [{ title: 'Alpha Song' }, { title: 'Beta Tune' }, { title: 'beta remix' }];
  assert.equal(findQueuePosition(tracks, 'BETA'), 2);
  assert.equal(findQueuePosition(tracks, 'remix'), 3);
  assert.equal(findQueuePosition(tracks, 'zzz'), 0);
  assert.equal(findQueuePosition(tracks, '  '), 0);
});

// ---- real GuildQueue integration (stubbed storage/audio) ----
const storePath = require.resolve('../src/store');
let settings = { volume: 100, filterPresets: [], cleanupNowPlaying: 'edit', skipDuplicates: false, maxQueueLength: 500, maxTrackDuration: 10800 };
require.cache[storePath] = { id: storePath, filename: storePath, loaded: true, exports: { get: () => settings, set: (_g, p) => { settings = { ...settings, ...p }; return settings; } } };
require('../src/music/queue-store').createQueueStore = () => ({ delete() {}, set() {}, entries: () => [], flush: async () => {}, load: async () => {} });
require('../src/music/sources/youtube').stream = async () => ({ stream: new PassThrough(), kill() {} });
const music = require('../src/music/player');
const vc = { id: 'v1', members: { filter: () => ({ size: 1 }) }, guild: { voiceAdapterCreator: () => ({ sendPayload: () => true, destroy() {} }) } };
const sent = [];
const text = { send: async (payload) => { sent.push(payload); return { edit: async () => {}, delete: async () => {} }; } };
const wait = (ms = 25) => new Promise((resolve) => setTimeout(resolve, ms));
const song = (id, extra = {}) => ({ title: `Song ${id}`, url: `https://www.youtube.com/watch?v=${id}000000`, duration: 180, source: 'youtube', ...extra });
const fresh = () => { music.getQueue('s')?.destroy(); return music.getOrCreate('s', vc, text); };
test.after(() => music.getQueue('s')?.destroy());

test('sleep timer: setSleep schedules, clearSleep cancels, badges show it, destroy cleans up', async () => {
  const q = fresh();
  q.enqueue([song('a'), song('b')]); await wait();
  q.setSleep({ minutes: 20 });
  assert.ok(q.sleepAt > Date.now());
  assert.ok(q.sleepTimer);
  assert.match(q.getBadges().join(' '), /😴 Sleep in 20m/);
  q.setSleep({ afterTrack: true });
  assert.equal(q.sleepTimer, null);
  assert.match(q.getBadges().join(' '), /Sleep after this track/);
  q.clearSleep();
  assert.equal(q.getBadges().some((b) => b.includes('😴')), false);
  q.setSleep({ minutes: 5 });
  q.destroy();
  assert.equal(q.sleepTimer, null);
});

test('sleep timer: "after this track" stops and leaves when the track ends', async () => {
  const q = fresh();
  q.enqueue([song('a'), song('b')]); await wait();
  q.setSleep({ afterTrack: true });
  q.skip(); await wait();
  assert.equal(music.getQueue('s'), undefined, 'queue destroyed (bot left)');
  assert.match(sent.at(-1).embeds[0].toJSON().description, /Sleep timer finished/);
});

test('sleep timer: the timed variant fires sleepNow after its delay', async () => {
  const q = fresh();
  q.enqueue([song('a')]); await wait();
  let slept = 0;
  q.sleepNow = () => { slept++; q.destroy(); };
  q.setSleep({ minutes: 0.0005 }); // 30ms
  await wait(80);
  assert.equal(slept, 1);
});

test('dedupe(): removes duplicate videos from the queue and reports the count', async () => {
  const q = fresh();
  q.enqueue([song('a'), song('b'), song('a'), song('c'), song('b')]); await wait();
  assert.equal(q.current.title, 'Song a');
  assert.equal(q.dedupe(), 2, 'the second a (already playing) and the second b');
  assert.deepEqual(q.tracks.map((t) => t.title), ['Song b', 'Song c']);
  assert.equal(q.dedupe(), 0);
  q.destroy();
});

test('skip-duplicates setting: enqueue and playNext ignore songs already queued, error when nothing is new', async () => {
  settings = { ...settings, skipDuplicates: true };
  const q = fresh();
  q.enqueue([song('a'), song('b')]); await wait();
  q.enqueue([song('b'), song('c')]);
  assert.deepEqual(q.tracks.map((t) => t.title), ['Song b', 'Song c']);
  assert.throws(() => q.enqueue([song('a')]), /already in the queue/);
  q.playNext([song('c'), song('d')]);
  assert.deepEqual(q.tracks.map((t) => t.title), ['Song d', 'Song b', 'Song c']);
  q.destroy();
  settings = { ...settings, skipDuplicates: false };
  const q2 = fresh();
  q2.enqueue([song('a')]); await wait();
  q2.enqueue([song('a')]);
  assert.equal(q2.tracks.length, 1, 'duplicates allowed when the setting is off');
  q2.destroy();
});

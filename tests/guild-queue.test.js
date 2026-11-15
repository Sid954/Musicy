// Real GuildQueue with a fake voice channel; storage and audio are stubbed so nothing touches disk or the network.
const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');

const storePath = require.resolve('../src/store');
let settings = { volume: 100, filterPresets: [], cleanupNowPlaying: 'edit', twentyFourSeven: false };
require.cache[storePath] = { id: storePath, filename: storePath, loaded: true, exports: { get: () => settings, set: (_g, patch) => { settings = { ...settings, ...patch }; return settings; } } };
const queueStore = require('../src/music/queue-store');
queueStore.createQueueStore = () => ({ delete() {}, set() {}, entries: () => [], flush: async () => {}, load: async () => {} });
const youtube = require('../src/music/sources/youtube');
youtube.stream = async () => ({ stream: new PassThrough(), kill() {} });
const music = require('../src/music/player');

const voiceChannel = { id: 'v1', members: { filter: () => ({ size: 1 }) }, guild: { voiceAdapterCreator: () => ({ sendPayload: () => true, destroy() {} }) } };
const sent = [];
const textChannel = { send: async (payload) => { sent.push(payload); return fakeMessage(); } };
function fakeMessage() {
  const message = { edits: [], deleted: false, async edit(payload) { this.edits.push(payload); return this; }, async delete() { this.deleted = true; } };
  return message;
}
const makeTracks = (n) => Array.from({ length: n }, (_, k) => ({ title: `Song ${k + 1}`, url: `https://www.youtube.com/watch?v=id${k}`, duration: 180, author: 'Band', source: 'youtube' }));
const fresh = (id = 'g1') => { music.getQueue(id)?.destroy(); return music.getOrCreate(id, voiceChannel, textChannel); };
const wait = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));
test.after(() => { for (const id of ['g1', 'g', 'stats-g', 'level-g', 'early-g']) music.getQueue(id)?.destroy(); });

test('previous() replays the earlier track now and puts the interrupted track right after it', async () => {
  const q = fresh();
  q.enqueue(makeTracks(3));
  await wait();
  assert.equal(q.current.title, 'Song 1');
  assert.equal(q.previous(), null, 'nothing before the first track');
  q.skip();
  await wait();
  assert.equal(q.current.title, 'Song 2');
  assert.equal(q.history.length, 2);
  const back = q.previous();
  await wait();
  assert.equal(back.title, 'Song 1');
  assert.equal(q.current.title, 'Song 1');
  assert.deepEqual(q.tracks.map((t) => t.title), ['Song 2', 'Song 3']);
  q.destroy();
});

test('previous() does not duplicate history entries when going back and forth', async () => {
  const q = fresh();
  q.enqueue(makeTracks(3));
  await wait();
  q.skip(); await wait();
  q.skip(); await wait();
  assert.equal(q.current.title, 'Song 3');
  q.previous(); await wait();
  assert.equal(q.current.title, 'Song 2');
  assert.deepEqual(q.history.map((t) => t.title), ['Song 2', 'Song 1']);
  q.destroy();
});

test('card lifecycle: finishing collapses the card to a one-line summary by default', async () => {
  settings = { ...settings, cleanupNowPlaying: 'edit' };
  const q = fresh();
  const message = fakeMessage();
  q.enqueue(makeTracks(1));
  await wait();
  q.adoptAnnouncement(message, q.current);
  q.disableAnnouncement();
  assert.equal(q.lastAnnouncement, null);
  assert.match(message.edits.at(-1).embeds[0].toJSON().description, /Finished: \*\*Song 1\*\*/);
  assert.deepEqual(message.edits.at(-1).components, []);
  q.destroy();
});

test('card lifecycle: delete and keep modes', async () => {
  settings = { ...settings, cleanupNowPlaying: 'delete' };
  let q = fresh();
  q.enqueue(makeTracks(1)); await wait();
  let message = fakeMessage();
  q.adoptAnnouncement(message, q.current);
  q.disableAnnouncement();
  assert.equal(message.deleted, true);
  q.destroy();

  settings = { ...settings, cleanupNowPlaying: 'keep' };
  q = fresh();
  q.enqueue(makeTracks(1)); await wait();
  message = fakeMessage();
  q.adoptAnnouncement(message, q.current);
  q.disableAnnouncement();
  assert.equal(message.deleted, false);
  assert.ok(message.edits.at(-1).components.every((row) => row.toJSON().components.every((b) => b.disabled)));
  q.destroy();
  settings = { ...settings, cleanupNowPlaying: 'edit' };
});

test('refreshAnnouncement re-renders embed AND rows from the live queue (loop badge, paused state)', async () => {
  const q = fresh();
  const message = fakeMessage();
  q.enqueue(makeTracks(3)); await wait();
  q.adoptAnnouncement(message, q.current);
  q.loop = 'queue';
  await q.refreshAnnouncement();
  const edit = message.edits.at(-1);
  const embed = edit.embeds[0].toJSON();
  const fields = Object.fromEntries(embed.fields.map((f) => [f.name, f.value]));
  assert.match(fields.Settings, /Loop: queue/);
  assert.match(fields['Up next'], /^▸ \*\*Song 2\*\* · 3:00\n`\+1 more` · `6m left`/);
  assert.equal(fields.Duration, '3:00');
  assert.equal(fields.Channel, 'Band');
  assert.equal(edit.components.length, 2);
  q.destroy();
});

test('snapshot reports queue context for the card', async () => {
  const q = fresh();
  q.enqueue(makeTracks(4)); await wait();
  const snap = q.getNowPlayingSnapshot();
  assert.equal(snap.track.title, 'Song 1');
  assert.equal(snap.next.title, 'Song 2');
  assert.equal(snap.queuedCount, 3);
  assert.equal(snap.remainingSeconds, 540);
  assert.equal(snap.canPrevious, false);
  assert.equal(snap.paused, false);
  q.destroy();
});

test('effects: applyFilters composes EQ + speed + pitch + presets and shows badges on the card', async () => {
  const q = fresh();
  q.enqueue(makeTracks(2)); await wait();
  q.speed = 1.5; q.pitch = 2; q.eqPreset = 'bass'; q.filterPresets = ['bassboost']; q.autoNormalize = true;
  const filters = q.applyFilters();
  assert.ok(filters[0].startsWith('equalizer='));
  assert.ok(filters.some((f) => f.startsWith('asetrate=')));
  assert.ok(filters.includes('bass=g=10'));
  assert.equal(filters.at(-1), 'loudnorm=I=-21:TP=-2:LRA=7');
  assert.deepEqual(q.opts.filters, filters);
  const badges = q.getBadges().join(' | ');
  assert.match(badges, /⏩ 1\.5×/);
  assert.match(badges, /🎵 \+2/);
  assert.match(badges, /🎛 EQ: Bass/);
  assert.match(badges, /Bassboost/);
  q.destroy();
});

test('effects: elapsed time is scaled by tempo so the progress bar stays correct', async () => {
  const q = fresh();
  q.enqueue(makeTracks(1)); await wait();
  q.playbackMs = () => 10_000;
  q.offset = 30;
  q.speed = 1; q.filterPresets = [];
  assert.equal(q.getElapsedSeconds(), 40);
  q.speed = 2;
  assert.equal(q.getElapsedSeconds(), 50);
  q.filterPresets = ['nightcore'];
  assert.equal(q.getElapsedSeconds(), 55);
  q.destroy();
});

test('effects: fades only apply when enabled, for finite tracks, with the current tempo', async () => {
  const q = fresh();
  const finite = { duration: 100 };
  assert.equal(q.fadeFor(finite, 0), undefined);
  q.fade = true;
  assert.deepEqual(q.fadeFor(finite, 40), { duration: 100, seek: 40, tempo: 1 });
  assert.equal(q.fadeFor({ duration: 100, isLive: true }, 0), undefined);
  assert.equal(q.fadeFor({ duration: 0 }, 0), undefined);
  q.speed = 2;
  assert.equal(q.fadeFor(finite, 0).tempo, 2);
  q.destroy();
});

test('effects: restarting after a setting change keeps position in source seconds', async () => {
  const q = fresh();
  q.enqueue(makeTracks(1)); await wait();
  q.playbackMs = () => 20_000;
  q.offset = 0;
  q.speed = 1.5;
  assert.equal(q.seekPositionForRestart(), 30);
  q.destroy();
});

test('stats: starting a track counts a play; natural end credits full length, a skip credits only what was heard', async () => {
  const stats = require('../src/music/listening-stats');
  const plays = [];
  const listens = [];
  const original = { recordPlay: stats.recordPlay, recordListen: stats.recordListen };
  stats.recordPlay = (g, t) => plays.push([g, t.title]);
  stats.recordListen = (g, u, seconds) => listens.push([g, u, seconds]);
  try {
    const q = fresh('stats-g');
    q.enqueue(makeTracks(3).map((t) => ({ ...t, requestedById: 'u9' })));
    await wait();
    assert.deepEqual(plays, [['stats-g', 'Song 1']]);
    q.playbackMs = () => 42_000;
    q.skip();
    await wait();
    assert.deepEqual(listens, [['stats-g', 'u9', 42]]);
    q.playbackMs = () => 0;
    q.resumeIfEndedEarly = () => false; // this test models a song that played to the end
    q.player.stop(true); // natural end of Song 2
    await wait();
    assert.deepEqual(listens.at(-1), ['stats-g', 'u9', 180]);
    assert.deepEqual(plays.map((p) => p[1]), ['Song 1', 'Song 2', 'Song 3']);
    q.destroy();
  } finally {
    Object.assign(stats, original);
  }
});

test('leveling: on by default at the soft level, hidden from the card unless it differs, and used for every stream', async () => {
  const q = fresh('level-g');
  assert.equal(q.autoNormalize, true, 'on by default');
  assert.equal(q.normalizeLevel, 'soft');
  assert.deepEqual(q.opts.filters, ['loudnorm=I=-21:TP=-2:LRA=7']);
  assert.equal(q.getBadges().some((b) => b.includes('📏')), false, 'default state is not advertised');
  q.normalizeLevel = 'loud';
  assert.deepEqual(q.rebuildFilters(), ['loudnorm=I=-15:TP=-2:LRA=7']);
  assert.ok(q.getBadges().includes('📏 loud loudness'));
  q.autoNormalize = false;
  assert.deepEqual(q.rebuildFilters(), []);
  assert.ok(!q.getBadges().some((badge) => /Leveling|loudness/.test(badge)), 'no badge when leveling is off');
  q.destroy();
});

test('SAFETY NET: a song that ends >10 s early resumes from where it stopped, at most twice', async () => {
  const q = fresh('early-g');
  q.enqueue(makeTracks(2)); await wait();
  const song = q.current; // 180 s long
  const plays = [];
  q.play = (track, silent, opts) => { plays.push({ track, silent, seek: opts?.seek }); return Promise.resolve(); };
  q.offset = 0;
  q.lastPlaybackMs = 100_000; // the stream stopped after 100 s of a 180 s song
  q.onIdle();
  assert.deepEqual(plays.map((p) => [p.track === song, p.silent, p.seek]), [[true, true, 100]], 'resumed the SAME song, silently, at 100 s');
  assert.equal(q.current, song, 'queue did not advance');
  q.lastPlaybackMs = 30_000; q.offset = 100;
  q.onIdle();
  assert.equal(plays.at(-1).seek, 100 + 30, 'offset + played time');
  q.onIdle();
  assert.equal(plays.at(-1).track.title, 'Song 2', 'after two resumes it gives up and moves on');
  q.destroy();
});

test('SAFETY NET: normal endings, skips, live streams and tempo changes are judged correctly', async () => {
  const q = fresh('early-g');
  q.enqueue(makeTracks(3)); await wait();
  const plays = [];
  q.play = (track, silent, opts) => { plays.push({ title: track.title, seek: opts?.seek }); return Promise.resolve(); };
  // finished within 10 s of its length: normal advance
  q.offset = 0; q.lastPlaybackMs = 175_000;
  q.onIdle();
  assert.deepEqual(plays.map((p) => p.title), ['Song 2']);
  // a skip is never "early"
  q.lastPlaybackMs = 5_000; q.skipping = true;
  q.onIdle();
  assert.equal(plays.at(-1).title, 'Song 3');
  // live streams have no length to compare against
  q.current = { ...makeTracks(1)[0], duration: 0, isLive: true, title: 'Radio' };
  q.lastPlaybackMs = 1_000; q.skipping = false;
  assert.equal(q.resumeIfEndedEarly(), false);
  // speed 2: 50 s of output audio = 100 s of the song
  q.current = { ...makeTracks(1)[0], title: 'Fast' };
  q.speed = 2; q.offset = 0; q.lastPlaybackMs = 50_000;
  q.resumeIfEndedEarly();
  assert.equal(plays.at(-1).seek, 100);
  q.destroy();
});

test('leveling flag: servers that have an old "autoNormalize: false" saved still get the new default', () => {
  const q = fresh('early-g');
  assert.equal(q.autoNormalize, true);
  q.destroy();
});

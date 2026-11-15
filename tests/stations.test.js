const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { STATIONS, findStation, stationToTrack, buildStationOptions, nextReconnect } = require('../src/music/stations');

test('station list is valid for a Discord select menu and has unique ids and https streams', () => {
  assert.ok(STATIONS.length >= 8 && STATIONS.length <= 25);
  assert.equal(new Set(STATIONS.map((s) => s.id)).size, STATIONS.length);
  for (const station of STATIONS) {
    assert.match(station.url, /^https:\/\//, station.id);
    assert.ok(station.name.length <= 100 && station.genre.length <= 100, station.id);
  }
  const options = buildStationOptions();
  assert.equal(options.length, STATIONS.length);
  assert.ok(options.every((o) => o.label && o.value && o.description));
  assert.equal(buildStationOptions(Array.from({ length: 40 }, (_, k) => ({ id: `s${k}`, name: 'n', genre: 'g' }))).length, 25);
});

test('stations become live tracks that stream directly (no yt-dlp lookup)', () => {
  const track = stationToTrack(findStation('groovesalad'));
  assert.equal(track.isLive, true);
  assert.equal(track.duration, 0);
  assert.equal(track.source, 'ytdlp-generic');
  assert.equal(track.station, 'groovesalad');
  assert.equal(findStation('nope'), null);
});

test('nextReconnect allows 5 attempts per minute, then gives up, then recovers', () => {
  let history = [];
  for (let n = 0; n < 5; n++) {
    const r = nextReconnect(history, 1000 + n);
    assert.equal(r.allow, true);
    history = r.history;
  }
  assert.equal(nextReconnect(history, 2000).allow, false);
  assert.equal(nextReconnect(history, 1000 + 61_000).allow, true);
  assert.deepEqual(nextReconnect(undefined, 5).history, [5]);
});

// ---- real GuildQueue: dropped station streams reconnect, skip/stop do not ----
const storePath = require.resolve('../src/store');
const settings = { volume: 100, filterPresets: [], cleanupNowPlaying: 'edit', maxQueueLength: 500, maxTrackDuration: 10800 };
require.cache[storePath] = { id: storePath, filename: storePath, loaded: true, exports: { get: () => settings, set: () => settings } };
require('../src/music/queue-store').createQueueStore = () => ({ delete() {}, set() {}, entries: () => [], flush: async () => {}, load: async () => {} });
const generic = require('../src/music/sources/ytdlp-generic');
let streams = 0;
generic.stream = async () => { streams++; return { stream: new PassThrough(), kill() {} }; };
const music = require('../src/music/player');
const vc = { id: 'v1', members: { filter: () => ({ size: 1 }) }, guild: { voiceAdapterCreator: () => ({ sendPayload: () => true, destroy() {} }) } };
const sent = [];
const text = { send: async (payload) => { sent.push(payload); return { edit: async () => {}, delete: async () => {} }; } };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
test.after(() => music.getQueue('r')?.destroy());

test('a station whose stream drops reconnects after ~2s and keeps the same track', async () => {
  music.getQueue('r')?.destroy();
  const q = music.getOrCreate('r', vc, text);
  streams = 0;
  q.enqueue([stationToTrack(findStation('lush'))]);
  await wait(50);
  assert.equal(streams, 1);
  const station = q.current;
  q.player.stop(true); // simulates the stream ending on its own
  await wait(2200);
  assert.equal(streams, 2, 'reconnected');
  assert.equal(q.current, station);
  q.destroy();
});

test('skipping or stopping a station does not trigger a reconnect', async () => {
  music.getQueue('r')?.destroy();
  const q = music.getOrCreate('r', vc, text);
  streams = 0;
  q.enqueue([stationToTrack(findStation('lush')), { title: 'Next', url: 'https://www.youtube.com/watch?v=abcdefg', duration: 100, source: 'ytdlp-generic' }]);
  await wait(50);
  q.skip();
  await wait(2300);
  assert.equal(streams, 2, 'one for the station, one for the next track; no station reconnect');
  assert.equal(q.current.title, 'Next');
  q.stop();
  await wait(2300);
  assert.equal(streams, 2);
  q.destroy();
});

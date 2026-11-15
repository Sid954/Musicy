const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { snapshotQueue, normalizeSnapshot, MAX_PERSISTED_TRACKS } = require('../src/music/queue-persistence');
const { createQueueStore } = require('../src/music/queue-store');
const { resolveSavedTrack } = require('../src/music/saved-track');

test('queue snapshot is capped and strips transient track fields', () => {
  const tracks = Array.from({ length: 120 }, (_, index) => ({ title: `T${index}`, url: `https://example.com/${index}`, duration: 60, prefetchedAudioUrl: 'secret', requestedById: 'user' }));
  const snapshot = snapshotQueue({ voiceChannelId: 'voice', textChannel: { id: 'text' }, current: tracks[0], tracks: tracks.slice(1), loop: 'queue', getElapsedSeconds: () => 12.9 }, 1000);
  assert.equal(snapshot.tracks.length + 1, MAX_PERSISTED_TRACKS);
  assert.equal(snapshot.position, 12);
  assert.equal('prefetchedAudioUrl' in snapshot.current, false);
  assert.equal('requestedById' in snapshot.current, false);
  assert.equal(normalizeSnapshot(snapshot).loop, 'queue');
});

test('lazy Spotify track identity survives queue snapshot round-trip and uses its query resolver', async () => {
  const track = { title: 'Later song', url: 'https://open.spotify.com/album/example', source: 'spotify', spotifyQuery: 'Artist - Later song' };
  const snapshot = snapshotQueue({ voiceChannelId: 'voice', textChannel: null, current: track, tracks: [], loop: 'off', getElapsedSeconds: () => 0 });
  const restored = normalizeSnapshot(snapshot).current;
  assert.equal(restored.spotifyQuery, track.spotifyQuery);
  let urls = 0;
  let queries = 0;
  const resolved = await resolveSavedTrack(restored, {
    resolve: async () => { urls++; return [{ title: 'wrong album first' }]; },
    resolveSpotifyQuery: async (query) => { queries++; assert.equal(query, track.spotifyQuery); return [{ title: 'Later song' }]; },
  });
  assert.equal(resolved[0].title, 'Later song');
  assert.equal(urls, 0);
  assert.equal(queries, 1);
});

test('queue store persists and reloads snapshots atomically', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'musicy-queues-'));
  try {
    const filePath = path.join(dir, 'queues.json');
    const store = createQueueStore({ filePath, debounceMs: 60_000 });
    await store.load();
    store.set('guild', { voiceChannelId: 'voice', current: { title: 'Song', url: 'https://example.com/song' }, tracks: [], loop: 'off', position: 5 });
    await store.flush();
    const next = createQueueStore({ filePath });
    await next.load();
    assert.equal(next.get('guild').current.title, 'Song');
    assert.deepEqual(await fs.readdir(dir), ['queues.json']);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

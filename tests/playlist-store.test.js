const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createPlaylistStore } = require('../src/music/playlist-store');
const ops = require('../src/music/playlist-ops');

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'musicy-playlists-'));
  try { await fn(dir); }
  finally { await fs.rm(dir, { recursive: true, force: true }); }
}

test('playlist store enforces user ownership and persists atomically', async () => {
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, 'playlists.json');
    const store = createPlaylistStore({ filePath, debounceMs: 60_000 });
    await store.load();
    store.create('user-a', 'Road trip');
    store.add('user-a', 'Road trip', [{ title: 'Song', url: 'https://example.com/song', duration: 60, author: 'Artist', ignored: true }]);
    await store.flush();
    const reloaded = createPlaylistStore({ filePath });
    await reloaded.load();
    assert.deepEqual(reloaded.list('user-a'), ['Road trip']);
    assert.deepEqual(reloaded.get('user-a', 'Road trip'), [{ title: 'Song', url: 'https://example.com/song', duration: 60, author: 'Artist' }]);
    assert.deepEqual(reloaded.list('user-b'), []);
    assert.deepEqual(await fs.readdir(dir), ['playlists.json']);
  });
});

test('playlist operations enforce name, count, and track limits', () => {
  let data = {};
  assert.throws(() => ops.normalizeName(''), /1–32/);
  assert.throws(() => ops.normalizeName('x'.repeat(33)), /1–32/);
  for (let index = 0; index < ops.MAX_PLAYLISTS; index++) data = ops.createPlaylist(data, 'u', `list-${index}`);
  assert.throws(() => ops.createPlaylist(data, 'u', 'too-many'), /25-playlist/);
  assert.throws(() => ops.createPlaylist(data, 'u', 'list-0'), /already exists/);
  data = ops.deletePlaylist(data, 'u', 'list-0');
  data = ops.addTracks(data, 'u', 'list-1', Array.from({ length: ops.MAX_TRACKS }, () => ({ title: 't', url: 'https://example.com', duration: 1, author: 'a', extra: 'ignored' })));
  assert.throws(() => ops.addTracks(data, 'u', 'list-1', [{ title: 'overflow', url: 'https://example.com' }]), /200 tracks/);
  assert.deepEqual(Object.keys(data.u['list-1'][0]).sort(), ['author', 'duration', 'title', 'url']);
  const spotify = ops.addTracks(ops.createPlaylist({}, 'u', 'saved'), 'u', 'saved', [{ title: 'Song', url: 'https://open.spotify.com/album/id', spotifyQuery: 'Artist - Song', source: 'spotify' }]);
  assert.equal(spotify.u.saved[0].url, 'https://www.youtube.com/results?search_query=Artist%20-%20Song');
  assert.equal(spotify.u.saved[0].spotifyQuery, 'Artist - Song');
  assert.throws(() => ops.removeTrack(data, 'u', 'list-1', 0), /position/);
});

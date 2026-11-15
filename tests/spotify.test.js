const test = require('node:test');
const assert = require('node:assert/strict');
const spotify = require('../src/music/sources/spotify');

// Fixtures follow the structure of the real open.spotify.com/embed pages (props.pageProps.state.data.entity).
const page = (entity) => `<html><head><title>x | Spotify</title></head><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { state: { data: { entity } } } } })}</script></body></html>`;
const trackEntity = { type: 'track', name: 'Never Gonna Give You Up', uri: 'spotify:track:4PTG3Z6ehGkBFwjybzWkR8', artists: [{ name: 'Rick Astley', uri: 'spotify:artist:1' }], duration: 213573, isPlayable: true };
const item = (n, extra = {}) => ({ uri: `spotify:track:${n}`, title: `Song ${n}`, subtitle: `Artist ${n}`, duration: 180000 + n * 1000, isPlayable: true, ...extra });
const albumEntity = { type: 'album', name: 'The Dark Side of the Moon', trackList: [item(1), item(2), item(3)] };

test('recognizes supported Spotify URLs (incl. language prefix, tracking params, embed) and rejects others', () => {
  assert.deepEqual(spotify.parseSpotifyUrl('https://open.spotify.com/track/abc123?si=ignored'), { type: 'track', id: 'abc123', url: 'https://open.spotify.com/track/abc123' });
  assert.deepEqual(spotify.parseSpotifyUrl('https://open.spotify.com/intl-de/album/Xy9'), { type: 'album', id: 'Xy9', url: 'https://open.spotify.com/album/Xy9' });
  assert.equal(spotify.parseSpotifyUrl('https://open.spotify.com/embed/playlist/P1').type, 'playlist');
  assert.equal(spotify.isSpotifyUrl('https://open.spotify.com/artist/abc'), false);
  assert.equal(spotify.isSpotifyUrl('https://evil.example/track/abc'), false);
  assert.equal(spotify.isSpotifyUrl('https://open.spotify.com.evil.example/track/abc'), false);
  assert.equal(spotify.isSpotifyUrl('http://open.spotify.com/track/abc'), false);
});

test('every open.spotify.com link belongs to this source, so unsupported ones get a clear message', async () => {
  assert.equal(spotify.canHandle('https://open.spotify.com/artist/abc'), true);
  assert.equal(spotify.canHandle('https://open.spotify.com.evil.example/track/abc'), false);
  assert.equal(spotify.canHandle('adele hello'), false);
  await assert.rejects(spotify.resolve('https://open.spotify.com/artist/abc'), /track, album and playlist/);
  await assert.rejects(spotify.resolve('https://open.spotify.com/show/abc'), /track, album and playlist/);
});

test('parses a track page: title, joined artists and duration in seconds', () => {
  const two = { ...trackEntity, artists: [{ name: 'A' }, { name: 'B' }] };
  assert.deepEqual(spotify.parseSpotifyEmbed(page(trackEntity)), {
    type: 'track', title: 'Never Gonna Give You Up',
    tracks: [{ title: 'Never Gonna Give You Up', artist: 'Rick Astley', duration: 214, uri: 'spotify:track:4PTG3Z6ehGkBFwjybzWkR8' }],
  });
  assert.equal(spotify.parseSpotifyEmbed(page(two)).tracks[0].artist, 'A, B');
});

test('parses an album/playlist: collection title, artist from subtitle, skips unplayable items, caps at 100', () => {
  const parsed = spotify.parseSpotifyEmbed(page(albumEntity));
  assert.equal(parsed.type, 'album');
  assert.equal(parsed.title, 'The Dark Side of the Moon');
  assert.deepEqual(parsed.tracks[0], { title: 'Song 1', artist: 'Artist 1', duration: 181, uri: 'spotify:track:1' });

  const withHoles = { type: 'playlist', name: 'Mix', trackList: [item(1), item(2, { isPlayable: false }), item(3, { title: '' }), item(4, { subtitle: '' }), item(5)] };
  assert.deepEqual(spotify.parseSpotifyEmbed(page(withHoles)).tracks.map((t) => t.title), ['Song 1', 'Song 5']);

  const huge = { type: 'playlist', name: 'Huge', trackList: Array.from({ length: 140 }, (_, n) => item(n + 1)) };
  assert.equal(spotify.parseSpotifyEmbed(page(huge)).tracks.length, 100);
  assert.equal(spotify.MAX_TRACKS, 100);
});

test('unusable pages: empty playlists, other entity types, garbage', () => {
  assert.equal(spotify.parseSpotifyEmbed(page({ type: 'playlist', name: 'Empty', trackList: [] })), null);
  assert.equal(spotify.parseSpotifyEmbed(page({ type: 'artist', name: 'Someone' })), null);
  assert.equal(spotify.parseSpotifyEmbed('<html>no data here</html>'), null);
  assert.equal(spotify.parseSpotifyEmbed('<script id="__NEXT_DATA__">{broken json</script>'), null);
});

test('last resort: a track page without the data block still yields "Song by Artist" from the title', () => {
  assert.deepEqual(spotify.parseSpotifyEmbed('<title>Song Name by Artist Name | Spotify</title>'), {
    type: 'track', title: 'Song Name', tracks: [{ title: 'Song Name', artist: 'Artist Name', duration: 0 }],
  });
});

test('fetchMetadata requests the keyless embed page and explains each failure', async () => {
  let requested;
  const ok = async (url) => { requested = url; return { ok: true, status: 200, text: async () => page(trackEntity) }; };
  const result = await spotify.fetchMetadata('https://open.spotify.com/intl-fr/track/abc?si=1', ok);
  assert.equal(requested, 'https://open.spotify.com/embed/track/abc');
  assert.equal(result.tracks[0].artist, 'Rick Astley');
  await assert.rejects(spotify.fetchMetadata('https://open.spotify.com/artist/abc', ok), /track, album and playlist/);
  await assert.rejects(spotify.fetchMetadata('https://open.spotify.com/track/abc', async () => ({ ok: false, status: 404, text: async () => '' })), /does not exist, or the playlist is private/);
  await assert.rejects(spotify.fetchMetadata('https://open.spotify.com/track/abc', async () => ({ ok: false, status: 500, text: async () => '' })), /could not be read right now/);
  await assert.rejects(spotify.fetchMetadata('https://open.spotify.com/track/abc', async () => { throw new Error('ECONNRESET'); }), /could not be reached/);
  await assert.rejects(spotify.fetchMetadata('https://open.spotify.com/track/abc', async () => ({ ok: true, status: 200, text: async () => '<html></html>' })), /No playable tracks/);
});

// ---- matching Spotify songs to the right YouTube video ----
const yt = (title, duration, url = `https://www.youtube.com/watch?v=${title.replace(/\W/g, '').slice(0, 11).padEnd(11, 'x')}`) => ({ title, duration, url, author: 'channel', source: 'youtube' });

test('length tolerance is 12 s or 8%, whichever is larger', () => {
  assert.equal(spotify.lengthTolerance(100), 12);
  assert.equal(spotify.lengthTolerance(300), 24);
  assert.equal(spotify.lengthTolerance(1000), 80);
});

test('match: a result of the right length is used after ONE lookup (fast path)', async () => {
  const calls = [];
  const best = yt('Rick Astley - Never Gonna Give You Up (Official Video)', 213);
  const result = await spotify.matchOnYoutube({ artist: 'Rick Astley', title: 'Never Gonna Give You Up', duration: 214 }, {
    resolve: async (q) => { calls.push(['resolve', q]); return [best]; },
    search: async () => { calls.push(['search']); return []; },
  });
  assert.equal(result, best);
  assert.deepEqual(calls, [['resolve', 'Rick Astley - Never Gonna Give You Up']]);
});

test('match: a wrong-length first result (10-hour loop) is replaced by the closest-length candidate', async () => {
  const loop = yt('Never Gonna Give You Up 10 HOURS', 36000, 'https://www.youtube.com/watch?v=loop0000000');
  const live = yt('Rick Astley live', 290, 'https://www.youtube.com/watch?v=live0000000');
  const right = yt('Rick Astley - Never Gonna Give You Up', 213, 'https://www.youtube.com/watch?v=right000000');
  const resolved = [];
  const result = await spotify.matchOnYoutube({ artist: 'Rick Astley', title: 'Never Gonna Give You Up', duration: 214 }, {
    resolve: async (q) => { resolved.push(q); return q.startsWith('https://') ? [{ ...right, prefetchedAudioUrl: 'direct' }] : [loop]; },
    search: async () => [loop, live, right],
  });
  assert.equal(result.url, right.url);
  assert.equal(result.prefetchedAudioUrl, 'direct', 'the winner is resolved again to get its audio URL');
  assert.deepEqual(resolved, ['Rick Astley - Never Gonna Give You Up', right.url]);
});

test('match: keeps the first result when nothing is closer, when lengths are unknown, or when the search fails', async () => {
  const first = yt('only result', 500, 'https://www.youtube.com/watch?v=first000000');
  const far = yt('even further', 9000, 'https://www.youtube.com/watch?v=far00000000');
  const base = { resolve: async () => [first] };
  assert.equal(await spotify.matchOnYoutube({ artist: 'A', title: 'T', duration: 200 }, { ...base, search: async () => [far] }), first);
  assert.equal(await spotify.matchOnYoutube({ artist: 'A', title: 'T', duration: 0 }, { ...base, search: async () => { throw new Error('must not search'); } }), first);
  assert.equal(await spotify.matchOnYoutube({ artist: 'A', title: 'T', duration: 200 }, { ...base, search: async () => { throw new Error('network'); } }), first);
  assert.equal(await spotify.matchOnYoutube({ artist: 'A', title: 'T', duration: 200 }, { ...base, search: async () => [first] }), first, 'the same video is not "better"');
  await assert.rejects(spotify.matchOnYoutube({ artist: 'A', title: 'T', duration: 200 }, { resolve: async () => [] }), /No matching YouTube audio/);
});

test('lazy tracks resolve with clean Spotify names, the collection title and a YouTube source; helper fields are removed', async () => {
  const track = {
    title: 'Pink Floyd - Time', author: 'Pink Floyd', duration: 423, url: 'https://open.spotify.com/album/x', source: 'spotify',
    spotifyQuery: 'Pink Floyd - Time', spotifyArtist: 'Pink Floyd', spotifyTitle: 'Time', spotifyDuration: 423, playlistTitle: 'The Dark Side of the Moon',
  };
  const matched = { ...yt('Pink Floyd - Time (2011 Remastered Version)', 416), prefetchedAudioUrl: 'https://cdn/audio' };
  await spotify.resolveLazy(track, { resolve: async () => [matched], search: async () => [] });
  assert.equal(track.title, 'Pink Floyd - Time', 'the clean Spotify title is kept');
  assert.equal(track.author, 'Pink Floyd');
  assert.equal(track.playlistTitle, 'The Dark Side of the Moon');
  assert.equal(track.source, 'youtube');
  assert.equal(track.duration, 416, 'the real playing length is used');
  assert.equal(track.url, matched.url);
  assert.equal(track.prefetchedAudioUrl, 'https://cdn/audio');
  for (const key of ['spotifyQuery', 'spotifyArtist', 'spotifyTitle', 'spotifyDuration']) assert.equal(key in track, false, key);
  assert.equal(await spotify.resolveLazy(track), track, 'already resolved tracks are left alone');
});

test('tracks restored from a saved queue (query text only) resolve by searching that text', async () => {
  const track = { title: 'Saved', url: 'https://open.spotify.com/album/x', source: 'spotify', spotifyQuery: 'Some Artist - Some Song' };
  const queries = [];
  await spotify.resolveLazy(track, { resolve: async (q) => { queries.push(q); return [yt('Some Artist - Some Song', 200)]; } });
  assert.deepEqual(queries, ['Some Artist - Some Song']);
  assert.equal(track.source, 'youtube');
  assert.equal('spotifyQuery' in track, false);
});

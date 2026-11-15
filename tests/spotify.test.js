const test = require('node:test');
const assert = require('node:assert/strict');
const spotify = require('../src/music/sources/spotify');

test('recognizes supported Spotify URLs and rejects unrelated or malformed links', () => {
  assert.deepEqual(spotify.parseSpotifyUrl('https://open.spotify.com/track/abc123?si=ignored'), {
    type: 'track', id: 'abc123', url: 'https://open.spotify.com/track/abc123',
  });
  assert.equal(spotify.isSpotifyUrl('https://open.spotify.com/album/Abc123'), true);
  assert.equal(spotify.isSpotifyUrl('https://open.spotify.com/artist/abc'), false);
  assert.equal(spotify.isSpotifyUrl('https://evil.example/track/abc'), false);
  assert.equal(spotify.isSpotifyUrl('http://open.spotify.com/track/abc'), false);
});

test('parses embedded Spotify track metadata, deduplicates it, and caps at 100', () => {
  const tracks = Array.from({ length: 105 }, (_, index) => ({
    type: 'track', name: `Song ${index}`, duration_ms: 180000,
    artists: [{ name: `Artist ${index}` }],
  }));
  tracks.push(tracks[0]);
  const html = `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { tracks } })}</script></html>`;
  const parsed = spotify.parseSpotifyEmbed(html);
  assert.equal(parsed.length, 100);
  assert.deepEqual(parsed[0], { title: 'Song 0', artist: 'Artist 0', duration: 180 });
});

test('uses title metadata fallback when embed JSON is unavailable', () => {
  assert.deepEqual(spotify.parseSpotifyEmbed('<title>Song Name by Artist Name | Spotify</title>'), [
    { title: 'Song Name', artist: 'Artist Name', duration: undefined },
  ]);
});

test('fetchMetadata uses a keyless embed request and validates URLs', async () => {
  let requested;
  const result = await spotify.fetchMetadata('https://open.spotify.com/track/abc', async (url) => {
    requested = url;
    return { ok: true, text: async () => '<title>Song by Artist | Spotify</title>' };
  });
  assert.equal(requested, 'https://open.spotify.com/embed/track/abc');
  assert.deepEqual(result, [{ title: 'Song', artist: 'Artist', duration: undefined }]);
  await assert.rejects(spotify.fetchMetadata('https://open.spotify.com/artist/abc', async () => ({ ok: true, text: async () => '' })));
});

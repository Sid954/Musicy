const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSavedTracks, isYoutubeWatchUrl } = require('../src/music/saved-track');

test('saved YouTube and Spotify entries load with no network resolve; others are resolved', async () => {
  const calls = [];
  const resolve = async (url) => { calls.push(url); return [{ title: 'resolved', url, duration: 1, source: 'ytdlp-generic' }]; };
  const tracks = await loadSavedTracks([
    { title: 'Yt', url: 'https://www.youtube.com/watch?v=abc', duration: 200, author: 'A' },
    { title: 'Sp', url: 'https://open.spotify.com/album/x', duration: 100, author: 'B', spotifyQuery: 'B - Sp' },
    { title: 'Sc', url: 'https://soundcloud.com/a/b', duration: 50, author: 'C' },
  ], { resolve });
  assert.deepEqual(calls, ['https://soundcloud.com/a/b']);
  assert.equal(tracks.length, 3);
  assert.deepEqual([tracks[0].source, tracks[1].source, tracks[2].source], ['youtube', 'spotify', 'ytdlp-generic']);
  assert.equal(tracks[1].spotifyQuery, 'B - Sp');
  assert.equal(tracks[0].duration, 200);
});

test('isYoutubeWatchUrl only accepts YouTube hosts', () => {
  assert.equal(isYoutubeWatchUrl('https://youtu.be/abc'), true);
  assert.equal(isYoutubeWatchUrl('https://evil.example/youtube.com'), false);
  assert.equal(isYoutubeWatchUrl('not a url'), false);
});

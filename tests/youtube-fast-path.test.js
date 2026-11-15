const test = require('node:test');
const assert = require('node:assert/strict');
const youtube = require('../src/music/sources/youtube');

const URL_OK = (expire) => `https://rr1.googlevideo.com/videoplayback?expire=${expire}&id=x`;

test('applyAudio stores the direct URL, codec and expiry for non-live tracks', () => {
  const expire = Math.floor(Date.now() / 1000) + 3600;
  const track = youtube.applyAudio({}, { url: URL_OK(expire), acodec: 'opus', is_live: false });
  assert.equal(track.prefetchedAudioUrl, URL_OK(expire));
  assert.equal(track.audioCodec, 'opus');
  assert.equal(track.audioUrlExpiresAt, expire * 1000);
});

test('applyAudio ignores live streams and non-http URLs', () => {
  assert.equal(youtube.applyAudio({}, { url: URL_OK(1), is_live: true }).prefetchedAudioUrl, undefined);
  assert.equal(youtube.applyAudio({}, { url: 'file:///etc/passwd' }).prefetchedAudioUrl, undefined);
  assert.equal(youtube.applyAudio({}, { url: undefined }).prefetchedAudioUrl, undefined);
});

test('direct URLs are only reused while they have time left', () => {
  const now = Date.now();
  const fresh = { prefetchedAudioUrl: 'u', audioUrlExpiresAt: now + 3_600_000 };
  const almostExpired = { prefetchedAudioUrl: 'u', audioUrlExpiresAt: now + 30_000 };
  const noExpiryOld = { prefetchedAudioUrl: 'u', audioUrlAt: now - 30 * 60_000 };
  const noExpiryNew = { prefetchedAudioUrl: 'u', audioUrlAt: now - 60_000 };
  assert.equal(youtube.isAudioUrlFresh(fresh, now), true);
  assert.equal(youtube.isAudioUrlFresh(almostExpired, now), false);
  assert.equal(youtube.isAudioUrlFresh(noExpiryOld, now), false);
  assert.equal(youtube.isAudioUrlFresh(noExpiryNew, now), true);
  assert.equal(youtube.isAudioUrlFresh({}, now), false);
});

test('consumePrefetchedUrl returns a fresh URL once and discards expired ones', () => {
  const fresh = { prefetchedAudioUrl: 'u', audioUrlExpiresAt: Date.now() + 3_600_000 };
  assert.equal(youtube.consumePrefetchedUrl(fresh), 'u');
  assert.equal(youtube.consumePrefetchedUrl(fresh), null);
  const stale = { prefetchedAudioUrl: 'u', audioUrlExpiresAt: Date.now() - 1000 };
  assert.equal(youtube.consumePrefetchedUrl(stale), null);
  assert.equal(stale.prefetchedAudioUrl, undefined);
});

test('only single videos and search text use the one-call fast path', () => {
  const single = [
    'dominic fike babydoll',
    'https://www.youtube.com/watch?v=jNQXAC9IVRw',
    'https://youtu.be/jNQXAC9IVRw',
    'https://www.youtube.com/shorts/abc123',
  ];
  const multi = [
    'https://www.youtube.com/playlist?list=PL123',
    'https://www.youtube.com/watch?v=jNQXAC9IVRw&list=RDjNQXAC9IVRw',
    'https://www.youtube.com/@somechannel',
    'https://soundcloud.com/a/b',
  ];
  for (const q of single) assert.equal(youtube.isSingleVideoQuery(q), true, q);
  for (const q of multi) assert.equal(youtube.isSingleVideoQuery(q), false, q);
});

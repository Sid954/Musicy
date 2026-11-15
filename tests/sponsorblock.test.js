const test = require('node:test');
const assert = require('node:assert/strict');
const sponsorBlock = require('../src/music/sponsorblock');

test('extracts YouTube IDs only from supported YouTube URLs', () => {
  assert.equal(sponsorBlock.youtubeVideoId({ url: 'https://www.youtube.com/watch?v=abc123' }), 'abc123');
  assert.equal(sponsorBlock.youtubeVideoId({ url: 'https://youtu.be/xyz789?t=5' }), 'xyz789');
  assert.equal(sponsorBlock.youtubeVideoId({ url: 'https://youtube.com/shorts/shortid' }), 'shortid');
  assert.equal(sponsorBlock.youtubeVideoId({ url: 'https://example.com/watch?v=abc' }), null);
});

test('normalizes allowed SponsorBlock segments and selects the next unfinished segment', () => {
  const segments = sponsorBlock.normalizeSegments([
    { category: 'sponsor', segment: [20, 30] },
    { category: 'music_offtopic', segment: [2, 8] },
    { category: 'intro', segment: [0, 5] },
    { category: 'outro', segment: [9, 9] },
  ]);
  assert.deepEqual(segments.map(({ category }) => category), ['intro', 'sponsor']);
  assert.deepEqual(sponsorBlock.nextSegment(segments, 2), segments[0]);
  assert.deepEqual(sponsorBlock.nextSegment(segments, 5), segments[1]);
  assert.equal(sponsorBlock.nextSegment(segments, 30), null);
});

test('fetches and caches segments, and silently ignores API failures', async () => {
  sponsorBlock.clearCache();
  let requests = 0;
  const fetchImpl = async (url) => {
    requests++;
    assert.match(url, /videoID=cache-test/);
    return { ok: true, json: async () => [{ category: 'sponsor', segment: [10, 20] }] };
  };
  const track = { url: 'https://youtu.be/cache-test' };
  assert.equal((await sponsorBlock.getSegments(track, fetchImpl)).length, 1);
  assert.equal((await sponsorBlock.getSegments(track, fetchImpl)).length, 1);
  assert.equal(requests, 1);
  const failed = await sponsorBlock.getSegments({ url: 'https://youtu.be/failure-test' }, async () => { throw new Error('offline'); });
  assert.deepEqual(failed, []);
  sponsorBlock.clearCache();
});

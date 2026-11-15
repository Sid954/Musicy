const test = require('node:test');
const assert = require('node:assert/strict');
const { consumePrefetchedUrl } = require('../src/music/sources/youtube');

test('consumePrefetchedUrl returns and clears a cached direct URL exactly once', () => {
  const track = { prefetchedAudioUrl: 'https://audio.example/stream' };
  assert.equal(consumePrefetchedUrl(track), 'https://audio.example/stream');
  assert.equal(Object.hasOwn(track, 'prefetchedAudioUrl'), false);
  assert.equal(consumePrefetchedUrl(track), null);
});

test('consumePrefetchedUrl safely handles absent tracks and cache entries', () => {
  assert.equal(consumePrefetchedUrl(null), null);
  assert.equal(consumePrefetchedUrl({}), null);
});

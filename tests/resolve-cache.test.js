const test = require('node:test');
const assert = require('node:assert/strict');
const { createResolveCache, normalizeQuery, cloneTrack } = require('../src/music/resolve-cache');

const track = (n, extra = {}) => ({ title: `T${n}`, url: `https://youtu.be/id${n}`, duration: 100, prefetchedAudioUrl: `https://cdn/${n}`, ...extra });

test('queries are normalized so case and spacing do not miss the cache', () => {
  assert.equal(normalizeQuery('  Adele   HELLO '), 'adele hello');
  const cache = createResolveCache();
  cache.set('Adele Hello', track(1));
  assert.equal(cache.get('adele   hello').title, 'T1');
});

test('hits return independent copies without requester data (callers mutate tracks)', () => {
  const cache = createResolveCache();
  cache.set('q', track(1, { requestedBy: 'someone', requestedById: '1' }));
  const first = cache.get('q');
  assert.equal(first.requestedBy, undefined);
  first.requestedBy = 'Sid';
  delete first.prefetchedAudioUrl; // stream() consumes the URL on its copy
  const second = cache.get('q');
  assert.equal(second.requestedBy, undefined);
  assert.equal(second.prefetchedAudioUrl, 'https://cdn/1');
});

test('entries expire after the TTL', () => {
  let clock = 1000;
  const cache = createResolveCache({ ttlMs: 60_000, now: () => clock });
  cache.set('q', track(1));
  clock += 59_000;
  assert.ok(cache.get('q'));
  clock += 2_000;
  assert.equal(cache.get('q'), null);
  assert.equal(cache.size, 0);
});

test('entries whose audio URL is no longer fresh are discarded and never stored', () => {
  let fresh = true;
  const cache = createResolveCache({ isFresh: () => fresh });
  assert.equal(cache.set('q', track(1)), true);
  fresh = false;
  assert.equal(cache.get('q'), null);
  assert.equal(cache.set('q2', track(2)), false);
  assert.equal(cache.size, 0);
});

test('the cache is bounded and evicts the least recently used entry', () => {
  const cache = createResolveCache({ max: 3 });
  cache.set('a', track(1)); cache.set('b', track(2)); cache.set('c', track(3));
  cache.get('a'); // a is now most recent
  cache.set('d', track(4));
  assert.equal(cache.size, 3);
  assert.equal(cache.get('b'), null, 'b was least recently used');
  assert.ok(cache.get('a') && cache.get('c') && cache.get('d'));
});

test('empty queries and empty tracks are ignored; clear() empties the cache', () => {
  const cache = createResolveCache();
  assert.equal(cache.set('', track(1)), false);
  assert.equal(cache.set('q', null), false);
  cache.set('q', track(1));
  cache.clear();
  assert.equal(cache.get('q'), null);
  assert.equal(cloneTrack({ a: 1, requestedBy: 'x', prefetchPromise: 1 }).requestedBy, undefined);
});

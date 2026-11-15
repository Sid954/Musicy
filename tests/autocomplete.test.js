const test = require('node:test');
const assert = require('node:assert/strict');
const { createSuggestService, normalizeSuggestions } = require('../src/music/autocomplete');

test('normalizeSuggestions trims, truncates, deduplicates, and caps choices', () => {
  const long = 'x'.repeat(150);
  const values = normalizeSuggestions([null, [[' Alpha '], ['alpha'], [long], ...Array.from({ length: 30 }, (_, n) => [`q${n}`])]]);
  assert.equal(values[0], 'Alpha');
  assert.equal(values[1], long.slice(0, 100));
  assert.equal(values.length, 25);
});

test('suggestion service caches results with TTL and refreshes LRU order', async () => {
  let time = 100;
  let calls = 0;
  const service = createSuggestService({
    now: () => time,
    maxEntries: 2,
    ttlMs: 50,
    fetchFn: async (url) => {
      calls++;
      return { ok: true, json: async () => [null, [[decodeURIComponent(url.split('q=')[1]) + ' result']]] };
    },
  });
  assert.deepEqual(await service.suggest('a'), ['a result']);
  assert.deepEqual(await service.suggest('a'), ['a result']);
  assert.equal(calls, 1);
  await service.suggest('b');
  await service.suggest('a'); // refresh a's LRU position
  await service.suggest('c');
  assert.deepEqual([...service.cache.keys()], ['a', 'c']);
  time += 51;
  await service.suggest('a');
  assert.equal(calls, 4);
});

test('suggestion service fails silently and ignores empty queries', async () => {
  const service = createSuggestService({ fetchFn: async () => { throw new Error('offline'); } });
  assert.deepEqual(await service.suggest(''), []);
  assert.deepEqual(await service.suggest('query'), []);
});

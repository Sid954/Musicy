const test = require('node:test');
const assert = require('node:assert/strict');
const { PRESETS, buildFilterChain, updateFilters } = require('../src/music/filters');

test('buildFilterChain maps presets, keeps order, and removes duplicates', () => {
  assert.deepEqual(buildFilterChain(['nightcore', '8d', 'nightcore']), [PRESETS.nightcore, PRESETS['8d']]);
  assert.deepEqual(buildFilterChain([]), []);
  assert.deepEqual(buildFilterChain(['off', 'bassboost']), []);
  assert.throws(() => buildFilterChain(['not-a-filter']), /Unknown filter/);
});

test('optional normalization adds the specified filter and is off by default', () => {
  assert.deepEqual(buildFilterChain(['bassboost']), [PRESETS.bassboost]);
  assert.deepEqual(buildFilterChain([], true), ['loudnorm=I=-21:TP=-2:LRA=7'], 'default level is soft');
  assert.deepEqual(buildFilterChain([], true, 'soft'), ['loudnorm=I=-21:TP=-2:LRA=7']);
  assert.deepEqual(buildFilterChain([], true, 'normal'), ['loudnorm=I=-18:TP=-2:LRA=7']);
  assert.deepEqual(buildFilterChain([], true, 'loud'), ['loudnorm=I=-15:TP=-2:LRA=7']);
  assert.deepEqual(buildFilterChain([], true, 'bogus'), ['loudnorm=I=-21:TP=-2:LRA=7'], 'unknown levels fall back to the default');
  assert.deepEqual(buildFilterChain(['loudnorm'], true), ['loudnorm']);
});

test('updateFilters adds/removes presets and clears all filters', () => {
  assert.deepEqual(updateFilters([], 'add', 'bassboost'), ['bassboost']);
  assert.deepEqual(updateFilters(['bassboost'], 'add', 'bassboost'), ['bassboost']);
  assert.deepEqual(updateFilters(['bassboost', '8d'], 'remove', 'bassboost'), ['8d']);
  assert.deepEqual(updateFilters(['bassboost'], 'clear'), []);
  assert.throws(() => updateFilters([], 'add', 'unknown'), /valid filter/);
});

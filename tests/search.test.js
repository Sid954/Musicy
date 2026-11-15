const test = require('node:test');
const assert = require('node:assert/strict');
const { clampSearchCount } = require('../src/music/sources/youtube');

test('search result count is an integer bounded from 1 to 16, defaulting to 8', () => {
  assert.equal(clampSearchCount(3.8), 3);
  assert.equal(clampSearchCount(0), 8);
  assert.equal(clampSearchCount(undefined), 8);
  assert.equal(clampSearchCount(-2), 1);
  assert.equal(clampSearchCount(20), 16);
  assert.equal(clampSearchCount('2'), 2);
});

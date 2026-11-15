const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldRetryStream } = require('../src/music/playback');

test('stream retry is allowed only once before any output bytes', () => {
  assert.equal(shouldRetryStream({ error: new Error('early failure'), outputBytes: 0 }), true);
  assert.equal(shouldRetryStream({ error: new Error('late failure'), outputBytes: 1 }), false);
  assert.equal(shouldRetryStream({ error: new Error('second failure'), outputBytes: 0, alreadyRetried: true }), false);
  assert.equal(shouldRetryStream({ outputBytes: 0 }), false);
});

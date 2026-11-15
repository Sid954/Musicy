const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSeekTime, isSeekableTrack } = require('../src/music/time');

test('live and durationless tracks are not seekable', () => {
  assert.equal(isSeekableTrack({ duration: 120 }), true);
  assert.equal(isSeekableTrack({ duration: 0, isLive: true }), false);
  assert.equal(isSeekableTrack({ duration: 0 }), false);
  assert.equal(isSeekableTrack(null), false);
});

test('parseSeekTime accepts seconds and clock formats', () => {
  assert.deepEqual(parseSeekTime('90'), { seconds: 90, relative: false });
  assert.deepEqual(parseSeekTime('1:30'), { seconds: 90, relative: false });
  assert.deepEqual(parseSeekTime('1:02:03'), { seconds: 3723, relative: false });
});

test('parseSeekTime accepts signed relative offsets', () => {
  assert.deepEqual(parseSeekTime('+30'), { seconds: 30, relative: true });
  assert.deepEqual(parseSeekTime('-15'), { seconds: -15, relative: true });
});

test('parseSeekTime rejects malformed or out-of-range clock values', () => {
  for (const value of ['', '1:60', '1:2:99', '1:2:3:4', '1.5', '--3', 'abc']) {
    assert.equal(parseSeekTime(value), null, value);
  }
  assert.equal(parseSeekTime(30), null);
});

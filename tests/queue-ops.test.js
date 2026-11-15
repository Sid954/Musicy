const test = require('node:test');
const assert = require('node:assert/strict');
const { removeAt, moveTrack, shuffleTracks, takeFromPosition } = require('../src/music/queue-ops');

const names = (tracks) => tracks.map((track) => track.title);

test('removeAt uses 1-based positions and leaves the queue unchanged for invalid positions', () => {
  const tracks = [{ title: 'a' }, { title: 'b' }, { title: 'c' }];
  assert.equal(removeAt(tracks, 2).title, 'b');
  assert.deepEqual(names(tracks), ['a', 'c']);
  assert.equal(removeAt(tracks, 0), null);
  assert.equal(removeAt(tracks, 3), null);
  assert.deepEqual(names(tracks), ['a', 'c']);
});

test('moveTrack reorders with 1-based positions and bounds-checks both ends', () => {
  const tracks = [{ title: 'a' }, { title: 'b' }, { title: 'c' }];
  assert.equal(moveTrack(tracks, 1, 3), true);
  assert.deepEqual(names(tracks), ['b', 'c', 'a']);
  assert.equal(moveTrack(tracks, 0, 1), false);
  assert.equal(moveTrack(tracks, 1, 4), false);
  assert.deepEqual(names(tracks), ['b', 'c', 'a']);
});

test('shuffleTracks uses injected randomness and keeps all tracks', () => {
  const tracks = [{ title: 'a' }, { title: 'b' }, { title: 'c' }];
  shuffleTracks(tracks, () => 0);
  assert.deepEqual(names(tracks), ['b', 'c', 'a']);
  assert.deepEqual([...names(tracks)].sort(), ['a', 'b', 'c']);
});

test('takeFromPosition removes a selected upcoming track and reports discarded entries', () => {
  const tracks = [{ title: 'a' }, { title: 'b' }, { title: 'c' }];
  const result = takeFromPosition(tracks, 3);
  assert.equal(result.track.title, 'c');
  assert.equal(result.discarded, 2);
  assert.deepEqual(names(tracks), ['a', 'b']);
  assert.equal(takeFromPosition(tracks, 0), null);
  assert.equal(takeFromPosition(tracks, 3), null);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { addHistory, getHistoryTrack, cloneReplay } = require('../src/music/history');

test('addHistory puts newest tracks first, strips transient fields, and caps at 25', () => {
  let history = [];
  for (let index = 0; index < 30; index++) history = addHistory(history, { title: `track-${index}`, url: 'https://example.com/a', prefetchedAudioUrl: 'secret', prefetchPromise: Promise.resolve(), spotifyQuery: 'lazy' });
  assert.equal(history.length, 25);
  assert.equal(history[0].title, 'track-29');
  assert.equal(history.at(-1).title, 'track-5');
  assert.equal('prefetchPromise' in history[0], false);
  assert.equal('spotifyQuery' in history[0], true);
});

test('history positions are 1-based and replay clones avoid transient state', () => {
  const track = { title: 'song', url: 'https://example.com/song', prefetchedAudioUrl: 'cached', autoplay: true };
  const history = addHistory([], track);
  assert.equal(getHistoryTrack(history, 1).title, 'song');
  assert.equal(getHistoryTrack(history, 0), null);
  assert.equal(getHistoryTrack(history, 2), null);
  assert.deepEqual(cloneReplay(history[0]), { title: 'song', url: 'https://example.com/song' });
});

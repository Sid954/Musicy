const test = require('node:test');
const assert = require('node:assert/strict');
const { youtubeVideoId, rememberVideo, chooseUnplayed } = require('../src/music/autoplay');

test('extracts video IDs from supported YouTube URL forms', () => {
  assert.equal(youtubeVideoId({ url: 'https://www.youtube.com/watch?v=abc' }), 'abc');
  assert.equal(youtubeVideoId({ url: 'https://youtu.be/def' }), 'def');
  assert.equal(youtubeVideoId({ url: 'https://youtube.com/live/ghi' }), 'ghi');
  assert.equal(youtubeVideoId({ url: 'https://example.com/video/abc' }), null);
});

test('remembers only the most recent 50 distinct IDs', () => {
  let history = [];
  for (let index = 0; index < 55; index++) history = rememberVideo(history, { url: `https://youtu.be/id${index}` });
  assert.equal(history.length, 50);
  assert.equal(history[0], 'id5');
  assert.equal(history.at(-1), 'id54');
  assert.equal(rememberVideo(history, { url: 'https://youtu.be/id54' }).length, 50);
});

test('chooses the first track not present in recent history', () => {
  const tracks = ['a', 'b', 'c'].map((id) => ({ url: `https://youtu.be/${id}` }));
  assert.equal(chooseUnplayed(tracks, ['a', 'b']), tracks[2]);
  assert.equal(chooseUnplayed(tracks, ['a', 'b', 'c']), null);
});

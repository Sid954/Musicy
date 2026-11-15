const test = require('node:test');
const assert = require('node:assert/strict');
const { youtubeVideoId, trackThumbnail } = require('../src/music/thumbnail');

test('finds the video id in the usual YouTube URL shapes and rejects others', () => {
  assert.equal(youtubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=x'), 'dQw4w9WgXcQ');
  assert.equal(youtubeVideoId('https://youtu.be/dQw4w9WgXcQ?t=5'), 'dQw4w9WgXcQ');
  assert.equal(youtubeVideoId('https://music.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(youtubeVideoId('https://example.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(youtubeVideoId('https://www.youtube.com/playlist?list=abc'), null);
  assert.equal(youtubeVideoId('not a url'), null);
});

test('trackThumbnail keeps a real thumbnail, otherwise derives one for YouTube tracks', () => {
  assert.equal(trackThumbnail({ thumbnail: 'https://img/x.jpg', url: 'https://youtu.be/dQw4w9WgXcQ' }), 'https://img/x.jpg');
  assert.equal(trackThumbnail({ thumbnail: null, url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }), 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
  assert.equal(trackThumbnail({ url: 'https://stream.example/radio' }), null);
  assert.equal(trackThumbnail(undefined), null);
});

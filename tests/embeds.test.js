const test = require('node:test');
const assert = require('node:assert');
const { fmt, nowPlaying } = require('../src/embeds');

test('live now-playing embeds display LIVE and no progress bar', () => {
  const embed = nowPlaying({ title: 'Radio', url: 'https://example.com/radio', duration: 0, isLive: true }).toJSON();
  assert.match(embed.description, /LIVE/);
  assert.doesNotMatch(embed.description, /▰|▱/);
});

test('nowPlaying wrapper starts at 0:00 and keeps its footer note', () => {
  const embed = nowPlaying({ title: 'Song', url: 'https://example.com/s', duration: 120 }, '+ 3 more tracks queued').toJSON();
  assert.match(embed.description, / 0:00 \/ 2:00$/);
  assert.match(embed.description, /🔘/, 'the original slider bar');
  assert.equal(embed.footer.text, '+ 3 more tracks queued');
});

test('fmt formats durations', () => {
  assert.strictEqual(fmt(0), 'Live');
  assert.strictEqual(fmt(65), '1:05');
  assert.strictEqual(fmt(3725), '1:02:05');
});

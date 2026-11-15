const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyYtdlpError } = require('../src/music/sources/youtube');

test('classifies yt-dlp stderr into friendly known errors', () => {
  const cases = [
    ['Sign in to confirm you’re not a bot', 'BOT_CHECK'],
    ['This video is age-restricted', 'AGE_RESTRICTED'],
    ['Private video', 'UNAVAILABLE'],
    ['The uploader has not made this video available in your country', 'GEO_BLOCKED'],
    ['This live event will begin in a moment', 'LIVE_UNSUPPORTED'],
    ['Unable to download webpage: The read operation timed out', 'NETWORK'],
  ];

  for (const [stderr, code] of cases) {
    const result = classifyYtdlpError(stderr);
    assert.equal(result.code, code);
    assert.ok(result.message.length > 0);
    assert.equal(/ERROR:|extractor|timed out|not made this video/i.test(result.message), false);
  }
});

test('classifies private videos as unavailable and hides unrecognized stderr', () => {
  assert.equal(classifyYtdlpError('ERROR: Private video').code, 'UNAVAILABLE');
  assert.deepEqual(classifyYtdlpError('sensitive extractor details'), {
    code: 'UNKNOWN',
    message: "YouTube couldn't process that request. Please try another video or search.",
  });
});

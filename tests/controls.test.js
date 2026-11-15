const test = require('node:test');
const assert = require('node:assert/strict');
const { nowPlayingControls } = require('../src/embeds');

test('legacy nowPlayingControls wrapper exposes the new card controls', () => {
  const components = nowPlayingControls('track', true).flatMap((row) => row.toJSON().components);
  assert.equal(components.some((b) => b.custom_id === 'np:pause' && b.emoji.name === '▶️'), true);
  assert.equal(components.some((b) => b.custom_id === 'np:loop' && b.emoji.name === '🔂'), true);
});

test('now-playing controls can all be disabled when a track ends', () => {
  assert.equal(nowPlayingControls('off', false, true).flatMap((row) => row.toJSON().components).every((b) => b.disabled), true);
});

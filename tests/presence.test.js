const test = require('node:test');
const assert = require('node:assert/strict');
const { getPresenceText } = require('../src/music/presence');

test('presence shows song only when exactly one guild is playing', () => {
  assert.equal(getPresenceText([], 3), '/play | 3 servers');
  assert.equal(getPresenceText([{ current: { title: 'Song' } }], 3), '♫ Song');
  assert.equal(getPresenceText([{ current: { title: 'A' } }, { current: { title: 'B' } }], 3), '/play | 3 servers');
  assert.equal(getPresenceText([{ current: { title: 'x'.repeat(120) } }], 1).length, 94);
});

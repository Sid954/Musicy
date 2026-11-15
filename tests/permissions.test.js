const test = require('node:test');
const assert = require('node:assert/strict');
const { canUse, RESTRICTED_COMMANDS } = require('../src/music/permissions');
const roleMember = (roles = [], permissions = []) => ({ roles: { cache: { has: (id) => roles.includes(id) } }, permissions: { has: (flag) => permissions.includes(flag) } });

test('DJ restriction applies only to configured commands and allows role or server managers', () => {
  const settings = { djRole: 'dj' };
  assert.equal(canUse(roleMember(), 'stop', settings), false);
  assert.equal(canUse(roleMember(['dj']), 'stop', settings), true);
  assert.equal(canUse(roleMember([], ['ManageGuild']), 'stop', settings), true);
  assert.equal(canUse(roleMember(), 'queue', settings), true);
  assert.equal(RESTRICTED_COMMANDS.has('skip'), false);
  assert.equal(RESTRICTED_COMMANDS.has('loop'), false);
});

test('command-channel restriction applies uniformly and can be cleared', () => {
  assert.equal(canUse(roleMember(), 'play', { textChannel: 'music' }, 'general'), false);
  assert.equal(canUse(roleMember(), 'play', { textChannel: 'music' }, 'music'), true);
  assert.equal(canUse(roleMember(), 'play', { textChannel: null }, 'general'), true);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { canBypassVote, voteResult } = require('../src/music/voting');

const permissions = (values) => ({ has: (value) => values.includes(value) });

test('requester, DJ role, and guild administrators bypass the vote', () => {
  assert.equal(canBypassVote({ userId: 'u1', requesterId: 'u1' }), true);
  assert.equal(canBypassVote({ userId: 'u2', djRoleId: 'dj', roleIds: ['dj'] }), true);
  assert.equal(canBypassVote({ userId: 'u3', permissions: permissions(['ManageGuild']) }), true);
  assert.equal(canBypassVote({ userId: 'u4', permissions: permissions([]) }), false);
});

test('small channels skip immediately and larger channels require a unique majority', () => {
  const votes = new Set();
  assert.equal(voteResult({ humanCount: 2, votes, userId: 'u1' }).passed, true);
  assert.deepEqual(voteResult({ humanCount: 4, votes, userId: 'u1' }), { passed: false, bypassed: false, duplicate: false, votes: 1, required: 3 });
  assert.equal(voteResult({ humanCount: 4, votes, userId: 'u1' }).duplicate, true);
  voteResult({ humanCount: 4, votes, userId: 'u2' });
  assert.equal(voteResult({ humanCount: 4, votes, userId: 'u3' }).passed, true);
});

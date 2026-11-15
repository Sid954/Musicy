function canBypassVote({ userId, requesterId, permissions, djRoleId, roleIds = [] }) {
  if (requesterId && userId === requesterId) return true;
  if (djRoleId && roleIds.includes(djRoleId)) return true;
  return Boolean(permissions?.has?.('ManageGuild') || permissions?.has?.('Administrator'));
}

function voteResult({ humanCount, votes, userId, requesterId, permissions, djRoleId, roleIds }) {
  if (humanCount <= 2 || canBypassVote({ userId, requesterId, permissions, djRoleId, roleIds })) {
    return { passed: true, bypassed: true, votes: votes.size, required: 0 };
  }
  if (votes.has(userId)) return { passed: false, duplicate: true, votes: votes.size, required: Math.floor(humanCount / 2) + 1 };
  votes.add(userId);
  const required = Math.floor(humanCount / 2) + 1;
  return { passed: votes.size >= required, bypassed: false, duplicate: false, votes: votes.size, required };
}

module.exports = { canBypassVote, voteResult };

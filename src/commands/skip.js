const { SlashCommandBuilder } = require('discord.js');
const store = require('../store');
const voting = require('../music/voting');
const { needQueue, reply, authorize } = require('./_util');

function countHumans(channel) {
  return channel?.members?.filter((member) => !member.user.bot).size || 0;
}

module.exports = {
  data: new SlashCommandBuilder().setName('skip').setDescription('Vote to skip the current track'),
  async execute(i) {
    if (!await authorize(i)) return;
    const q = await needQueue(i);
    if (!q) return;
    if (!q.current) return reply(i, 'Nothing is playing.', true);
    const humans = countHumans(i.member.voice.channel);
    const result = voting.voteResult({
      humanCount: humans,
      votes: q.skipVotes,
      userId: i.user.id,
      requesterId: q.current.requestedById,
      permissions: i.member.permissions,
      djRoleId: store.get(i.guildId).djRole,
      roleIds: i.member.roles?.cache?.keys ? [...i.member.roles.cache.keys()] : [],
    });
    if (!result.passed) {
      if (result.duplicate) return reply(i, `You already voted to skip (${result.votes}/${result.required}).`, true);
      return reply(i, `Skip vote: **${result.votes}/${result.required}** votes.`, false);
    }
    const title = q.current.title;
    q.skip();
    await reply(i, result.bypassed && humans > 2 ? `Skipped **${title}**.` : `Skip vote passed (${result.votes || 0}/${result.required || 0}). Skipping **${title}**.`);
  },
};

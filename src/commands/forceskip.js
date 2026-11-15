const { SlashCommandBuilder } = require('discord.js');
const { PermissionFlagsBits } = require('discord.js');
const { needQueue, reply, authorize } = require('./_util');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('forceskip')
    .setDescription('Skip the current track without a vote')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(i) {
    if (!await authorize(i)) return;
    const q = await needQueue(i);
    if (!q) return;
    if (!i.member.permissions.has(PermissionFlagsBits.ManageGuild)) return reply(i, 'Manage Server permission is required.', true);
    const title = q.current?.title;
    if (!title) return reply(i, 'Nothing is playing.', true);
    q.skip();
    await reply(i, `Force-skipped **${title}**.`);
  },
};

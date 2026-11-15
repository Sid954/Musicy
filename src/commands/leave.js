const { SlashCommandBuilder } = require('discord.js');
const { needQueue, reply } = require('./_util');

module.exports = {
  data: new SlashCommandBuilder().setName('leave').setDescription('Leave the voice channel'),
  async execute(i) {
    const q = await needQueue(i);
    if (!q) return;
    q.destroy();
    await reply(i, 'Left the voice channel.');
  },
};

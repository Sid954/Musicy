const { SlashCommandBuilder } = require('discord.js');
const { needQueue, reply } = require('./_util');

module.exports = {
  data: new SlashCommandBuilder().setName('resume').setDescription('Resume playback'),
  async execute(i) {
    const q = await needQueue(i);
    if (!q) return;
    q.player.unpause();
    await reply(i, 'Resumed.');
  },
};

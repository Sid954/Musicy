const { SlashCommandBuilder } = require('discord.js');
const { needQueue, reply } = require('./_util');

module.exports = {
  data: new SlashCommandBuilder().setName('pause').setDescription('Pause playback'),
  async execute(i) {
    const q = await needQueue(i);
    if (!q) return;
    q.player.pause();
    await reply(i, 'Paused.');
  },
};

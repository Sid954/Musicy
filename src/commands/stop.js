const { SlashCommandBuilder } = require('discord.js');
const { needQueue, reply, authorize } = require('./_util');

module.exports = {
  data: new SlashCommandBuilder().setName('stop').setDescription('Stop playback and clear the queue'),
  async execute(i) {
    if (!await authorize(i)) return;
    const q = await needQueue(i);
    if (!q) return;
    q.stop();
    await reply(i, 'Stopped and cleared the queue.');
  },
};

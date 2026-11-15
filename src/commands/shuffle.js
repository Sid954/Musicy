const { SlashCommandBuilder } = require('discord.js');
const { needQueue, reply, authorize } = require('./_util');

module.exports = {
  data: new SlashCommandBuilder().setName('shuffle').setDescription('Shuffle the queued tracks'),
  async execute(i) {
    if (!await authorize(i)) return;
    const q = await needQueue(i);
    if (!q) return;
    if (q.tracks.length < 2) return reply(i, 'Add at least two tracks before shuffling.', true);
    q.shuffle();
    await reply(i, 'Shuffled the queue. Undo with `/undo`.');
  },
};

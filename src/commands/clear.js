const { SlashCommandBuilder } = require('discord.js');
const { needQueue, reply, authorize } = require('./_util');

module.exports = {
  data: new SlashCommandBuilder().setName('clear').setDescription('Clear upcoming tracks from the queue'),
  async execute(i) {
    if (!await authorize(i)) return;
    const q = await needQueue(i);
    if (!q) return;
    const count = q.clearQueue();
    await reply(i, count ? `Cleared **${count}** queued track${count === 1 ? '' : 's'}. Undo with \`/undo\`.` : 'There are no queued tracks to clear.');
  },
};

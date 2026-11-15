const { SlashCommandBuilder } = require('discord.js');
const { needQueue, reply, authorize } = require('./_util');

module.exports = {
  data: new SlashCommandBuilder().setName('dedupe').setDescription('Remove duplicate songs from the queue'),
  async execute(i) {
    if (!await authorize(i)) return;
    const q = await needQueue(i);
    if (!q) return;
    const removed = q.dedupe();
    await reply(i, removed ? `Removed **${removed}** duplicate track${removed === 1 ? '' : 's'}. Undo with \`/undo\`.` : 'No duplicates found in the queue.');
  },
};

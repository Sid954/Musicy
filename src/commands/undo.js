const { SlashCommandBuilder } = require('discord.js');
const embeds = require('../embeds');
const { needQueue, reply, authorize } = require('./_util');

module.exports = {
  data: new SlashCommandBuilder().setName('undo').setDescription('Undo the last change to the queue (remove, clear, shuffle, move, add, ...)'),
  async execute(i) {
    if (!await authorize(i)) return;
    const q = await needQueue(i);
    if (!q) return;
    const undone = q.undo();
    if (!undone) {
      return i.reply({ embeds: [embeds.error('Nothing to undo. Queue changes are remembered for 10 minutes.')], ephemeral: true });
    }
    await reply(i, `↩️ Undid **${undone.label}**. The queue has **${undone.count}** track${undone.count === 1 ? '' : 's'} again.`);
  },
};

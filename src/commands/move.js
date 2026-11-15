const { SlashCommandBuilder } = require('discord.js');
const { needQueue, reply, authorize } = require('./_util');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('move')
    .setDescription('Move a queued track')
    .addIntegerOption((o) => o.setName('from').setDescription('Current queue position').setRequired(true).setMinValue(1).setAutocomplete(true))
    .addIntegerOption((o) => o.setName('to').setDescription('New queue position').setRequired(true).setMinValue(1).setAutocomplete(true)),
  async autocomplete(i) { await require('../music/queue-position-autocomplete').respondQueuePositions(i); },
  async execute(i) {
    if (!await authorize(i)) return;
    const q = await needQueue(i);
    if (!q) return;
    const from = i.options.getInteger('from');
    const to = i.options.getInteger('to');
    if (!q.move(from, to)) return reply(i, 'One or both queue positions do not exist.', true);
    await reply(i, `Moved queue position **${from}** to **${to}**. Undo with \`/undo\`.`);
  },
};

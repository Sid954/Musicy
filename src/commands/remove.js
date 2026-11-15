const { SlashCommandBuilder } = require('discord.js');
const { needQueue, reply, authorize } = require('./_util');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Remove a queued track')
    .addIntegerOption((o) => o.setName('position').setDescription('Queue position (starting at 1)').setRequired(true).setMinValue(1).setAutocomplete(true)),
  async autocomplete(i) { await require('../music/queue-position-autocomplete').respondQueuePositions(i); },
  async execute(i) {
    if (!await authorize(i)) return;
    const q = await needQueue(i);
    if (!q) return;
    const track = q.remove(i.options.getInteger('position'));
    if (!track) return reply(i, 'That queue position does not exist.', true);
    await reply(i, `Removed **${track.title}** from the queue. Undo with \`/undo\`.`);
  },
};

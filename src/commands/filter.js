const { SlashCommandBuilder } = require('discord.js');
const music = require('../music/player');
const store = require('../store');
const { PRESETS, buildFilterChain, updateFilters } = require('../music/filters');
const { needQueue, reply, authorize } = require('./_util');

const presetChoices = Object.keys(PRESETS).map((name) => ({ name, value: name }));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('filter')
    .setDescription('Manage audio filter presets')
    .addSubcommand((sub) => sub.setName('add').setDescription('Add a filter').addStringOption((o) => o.setName('preset').setDescription('Filter preset').setRequired(true).addChoices(...presetChoices)))
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove a filter').addStringOption((o) => o.setName('preset').setDescription('Filter preset').setRequired(true).addChoices(...presetChoices.filter(({ value }) => value !== 'off'))))
    .addSubcommand((sub) => sub.setName('clear').setDescription('Remove all filters')),
  async execute(i) {
    if (!await authorize(i)) return;
    const q = await needQueue(i);
    if (!q) return;
    const action = i.options.getSubcommand();
    const preset = action === 'clear' ? undefined : i.options.getString('preset');
    let names;
    try { names = updateFilters(q.filterPresets, action, preset); }
    catch (error) { return reply(i, error.message, true); }
    q.filterPresets = names;
    store.set(i.guildId, { filterPresets: names });
    q.applyFilters();
    await reply(i, names.length ? `Filters: **${names.join(', ')}** (playback briefly restarts).` : 'All filters cleared.');
  },
};

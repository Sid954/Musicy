const { SlashCommandBuilder } = require('discord.js');
const { playQuery } = require('./_play-flow');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a song or playlist from YouTube')
    .addStringOption((o) => o.setName('query').setDescription('Search terms or YouTube URL').setRequired(true).setAutocomplete(true)),
  async autocomplete(i) {
    const choices = await require('../music/autocomplete').suggest(i.options.getFocused());
    await i.respond(choices.map((name) => ({ name, value: name })));
  },
  async execute(i) {
    return playQuery(i, i.options.getString('query'));
  },
};

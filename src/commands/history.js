const { SlashCommandBuilder } = require('discord.js');
const music = require('../music/player');
const embeds = require('../embeds');
const { showPaginatedList } = require('../music/list-view');

module.exports = {
  data: new SlashCommandBuilder().setName('history').setDescription('Show the last 25 played tracks'),
  async execute(i) {
    const q = music.getQueue(i.guildId);
    if (!q?.history.length) return i.reply({ embeds: [embeds.info('No tracks have played yet.')], ephemeral: true });
    await showPaginatedList(i, {
      title: 'Recently played',
      items: q.history,
      prefix: 'history',
      perPage: 10,
      formatItem: (track) => `**${String(track.title || 'Unknown').replace(/[\\[\\]`*_]/g, '')}** · ${embeds.fmt(track.duration)}`,
    });
  },
};

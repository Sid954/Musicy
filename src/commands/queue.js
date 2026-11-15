const { SlashCommandBuilder } = require('discord.js');
const music = require('../music/player');
const embeds = require('../embeds');
const { showQueue } = require('../music/queue-view');

module.exports = {
  data: new SlashCommandBuilder().setName('queue').setDescription('Browse the whole queue, page by page'),
  async execute(i) {
    const q = music.getQueue(i.guildId);
    if (!q || (!q.current && !q.tracks.length)) {
      return i.reply({ embeds: [embeds.error('The queue is empty.')], ephemeral: true });
    }
    await showQueue(i);
  },
};

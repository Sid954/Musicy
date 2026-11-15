const { SlashCommandBuilder } = require('discord.js');
const music = require('../music/player');
const embeds = require('../embeds');
const { buildNowPlayingEmbed } = require('../music/nowplaying-view');

module.exports = {
  data: new SlashCommandBuilder().setName('nowplaying').setDescription('Show the current track'),
  async execute(i) {
    const q = music.getQueue(i.guildId);
    if (!q || !q.current) return i.reply({ embeds: [embeds.error('Nothing is playing.')], ephemeral: true });
    await i.reply({ embeds: [buildNowPlayingEmbed(q.getNowPlayingSnapshot())] });
  },
};

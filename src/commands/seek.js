const { SlashCommandBuilder } = require('discord.js');
const { seekTo } = require('./_seek-util');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('seek')
    .setDescription('Seek within the current track')
    .addStringOption((o) => o.setName('time').setDescription('Seconds, M:SS, H:MM:SS, or relative +30/-15').setRequired(true)),
  async execute(i) {
    await seekTo(i);
  },
};

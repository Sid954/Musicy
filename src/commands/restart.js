const { SlashCommandBuilder } = require('discord.js');
const { seekTo } = require('./_seek-util');

module.exports = {
  data: new SlashCommandBuilder().setName('restart').setDescription('Restart the current track'),
  async execute(i) {
    await seekTo(i, true);
  },
};

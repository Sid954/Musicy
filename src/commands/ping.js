const { SlashCommandBuilder } = require('discord.js');
const embeds = require('../embeds');

module.exports = {
  data: new SlashCommandBuilder().setName('ping').setDescription('Show Discord API latency'),
  async execute(i) {
    await i.reply({ embeds: [embeds.info(`API latency: **${i.client.ws.ping} ms**.`)], ephemeral: true });
  },
};

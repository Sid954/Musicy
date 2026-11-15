const { SlashCommandBuilder } = require('discord.js');
const embeds = require('../embeds');
const { needQueue, reply, authorize } = require('./_util');

module.exports = {
  data: new SlashCommandBuilder().setName('previous').setDescription('Go back to the previous track'),
  async execute(i) {
    if (!await authorize(i)) return;
    const q = await needQueue(i);
    if (!q) return;
    const track = q.previous();
    if (!track) return i.reply({ embeds: [embeds.error('There is no previous track yet.')], ephemeral: true });
    await reply(i, `⏮ Going back to **${track.title}**. The track that was playing comes right after it.`);
  },
};

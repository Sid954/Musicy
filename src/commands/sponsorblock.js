const { SlashCommandBuilder } = require('discord.js');
const music = require('../music/player');
const store = require('../store');
const { needQueue, reply, authorize } = require('./_util');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sponsorblock')
    .setDescription('Toggle automatic SponsorBlock skipping')
    .addBooleanOption((o) => o.setName('enabled').setDescription('Skip sponsor, self-promo, intro, and outro segments').setRequired(true)),
  async execute(i) {
    if (!await authorize(i)) return;
    const q = await needQueue(i);
    if (!q) return;
    q.sponsorBlock = i.options.getBoolean('enabled');
    store.set(i.guildId, { sponsorBlock: q.sponsorBlock });
    q.scheduleSponsorBlock();
    await reply(i, `SponsorBlock ${q.sponsorBlock ? 'enabled' : 'disabled'}.`);
  },
};

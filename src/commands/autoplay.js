const { SlashCommandBuilder } = require('discord.js');
const music = require('../music/player');
const store = require('../store');
const { needQueue, reply, authorize } = require('./_util');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('autoplay')
    .setDescription('Toggle YouTube Mix autoplay when the queue empties')
    .addBooleanOption((o) => o.setName('enabled').setDescription('Enable autoplay').setRequired(true)),
  async execute(i) {
    if (!await authorize(i)) return;
    const q = await needQueue(i);
    if (!q) return;
    q.autoplay = i.options.getBoolean('enabled');
    q.autoplaySuppressed = false;
    store.set(i.guildId, { autoplay: q.autoplay });
    if (q.autoplay && !q.current && !q.tracks.length && q.lastTrack) q.advance();
    await reply(i, `Autoplay ${q.autoplay ? 'enabled' : 'disabled'}.`);
  },
};

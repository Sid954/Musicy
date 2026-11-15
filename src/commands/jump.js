const { SlashCommandBuilder } = require('discord.js');
const music = require('../music/player');
const embeds = require('../embeds');
const { needQueue, reply, authorize } = require('./_util');
const { findQueuePosition } = require('../music/collection');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('jump')
    .setDescription('Jump to the first queued song whose title contains some text')
    .addStringOption((o) => o.setName('text').setDescription('Part of the title').setRequired(true).setAutocomplete(true)),
  async autocomplete(i) {
    const q = music.getQueue(i.guildId);
    const typed = String(i.options.getFocused() || '').trim().toLowerCase();
    const choices = (q?.tracks || [])
      .map((track) => String(track.title || 'Unknown').slice(0, 100))
      .filter((title) => !typed || title.toLowerCase().includes(typed))
      .slice(0, 25)
      .map((title) => ({ name: title, value: title }));
    await i.respond(choices);
  },
  async execute(i) {
    if (!await authorize(i)) return;
    const q = await needQueue(i);
    if (!q) return;
    const position = findQueuePosition(q.tracks, i.options.getString('text'));
    if (!position) return i.reply({ embeds: [embeds.error('No queued song matches that text.')], ephemeral: true });
    const track = q.skipTo(position);
    await reply(i, `⏭ Jumping to **${track.title}** (was position ${position}).`);
  },
};

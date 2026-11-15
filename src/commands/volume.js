const { SlashCommandBuilder } = require('discord.js');
const music = require('../music/player');
const store = require('../store');
const { needQueue, reply, authorize } = require('./_util');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Set playback volume')
    .addIntegerOption((o) =>
      o.setName('level').setDescription('Volume percentage (1-200)').setRequired(true).setMinValue(1).setMaxValue(200),
    ),
  async execute(i) {
    if (!await authorize(i)) return;
    const q = await needQueue(i);
    if (!q) return;

    const level = q.applyVolume(i.options.getInteger('level'));
    await reply(i, `Volume set to **${level}%**${q.current ? ' (playback briefly restarts)' : ''}.`);
  },
};

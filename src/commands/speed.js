const { SlashCommandBuilder } = require('discord.js');
const store = require('../store');
const { needQueue, reply, authorize } = require('./_util');
const { SPEED_MIN, SPEED_MAX } = require('../music/effects');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('speed')
    .setDescription('Change playback speed without changing pitch (1 = normal)')
    .addNumberOption((o) => o.setName('factor').setDescription(`${SPEED_MIN} to ${SPEED_MAX}, e.g. 1.25`).setRequired(true).setMinValue(SPEED_MIN).setMaxValue(SPEED_MAX)),
  async execute(i) {
    if (!await authorize(i)) return;
    const q = await needQueue(i);
    if (!q) return;
    const factor = Math.round(i.options.getNumber('factor') * 100) / 100;
    q.speed = factor;
    store.set(i.guildId, { speed: factor });
    q.applyFilters();
    await reply(i, factor === 1 ? 'Speed reset to normal.' : `Speed set to **${factor}×**${q.current ? ' (playback briefly restarts)' : ''}.`);
  },
};

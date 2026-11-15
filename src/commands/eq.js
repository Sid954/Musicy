const { SlashCommandBuilder } = require('discord.js');
const store = require('../store');
const { needQueue, reply, authorize } = require('./_util');
const { EQ_BANDS, EQ_PRESETS, EQ_GAIN_LIMIT, eqGains } = require('../music/effects');

const bandLabel = (hz) => (hz >= 1000 ? `${hz / 1000} kHz` : `${hz} Hz`);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('eq')
    .setDescription('10-band equalizer')
    .addSubcommand((s) => s.setName('preset').setDescription('Apply an equalizer preset').addStringOption((o) => o.setName('name').setDescription('Preset').setRequired(true)
      .addChoices(...Object.keys(EQ_PRESETS).map((name) => ({ name, value: name })))))
    .addSubcommand((s) => s.setName('band').setDescription('Adjust one band on top of the current preset')
      .addIntegerOption((o) => o.setName('frequency').setDescription('Band').setRequired(true).addChoices(...EQ_BANDS.map((hz) => ({ name: bandLabel(hz), value: hz }))))
      .addIntegerOption((o) => o.setName('gain').setDescription(`Gain in dB (${-EQ_GAIN_LIMIT} to ${EQ_GAIN_LIMIT})`).setRequired(true).setMinValue(-EQ_GAIN_LIMIT).setMaxValue(EQ_GAIN_LIMIT)))
    .addSubcommand((s) => s.setName('show').setDescription('Show the current equalizer'))
    .addSubcommand((s) => s.setName('reset').setDescription('Back to a flat response')),
  async execute(i) {
    const sub = i.options.getSubcommand();
    if (sub !== 'show' && !await authorize(i)) return;
    const q = await needQueue(i);
    if (!q) return;

    if (sub === 'show') {
      const gains = eqGains(q.eqPreset, q.eqBands);
      const lines = EQ_BANDS.map((hz, index) => `\`${bandLabel(hz).padStart(7)}\` ${gains[index] > 0 ? '+' : ''}${gains[index]} dB`);
      return reply(i, `**EQ: ${q.eqPreset}**${Object.keys(q.eqBands).length ? ' (+ custom bands)' : ''}\n${lines.join('\n')}`, true);
    }
    if (sub === 'preset') { q.eqPreset = i.options.getString('name'); q.eqBands = {}; }
    if (sub === 'band') q.eqBands = { ...q.eqBands, [i.options.getInteger('frequency')]: i.options.getInteger('gain') };
    if (sub === 'reset') { q.eqPreset = 'flat'; q.eqBands = {}; }
    store.set(i.guildId, { eqPreset: q.eqPreset, eqBands: q.eqBands });
    q.applyFilters();
    await reply(i, sub === 'reset' ? 'Equalizer reset to flat.' : `Equalizer: **${q.eqPreset}**${Object.keys(q.eqBands).length ? ' with custom bands' : ''}${q.current ? ' (playback briefly restarts)' : ''}.`);
  },
};

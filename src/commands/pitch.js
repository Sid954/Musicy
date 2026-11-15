const { SlashCommandBuilder } = require('discord.js');
const store = require('../store');
const { needQueue, reply, authorize } = require('./_util');
const { PITCH_MIN, PITCH_MAX } = require('../music/effects');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pitch')
    .setDescription('Shift pitch in semitones without changing speed (0 = normal)')
    .addIntegerOption((o) => o.setName('semitones').setDescription(`${PITCH_MIN} to +${PITCH_MAX}`).setRequired(true).setMinValue(PITCH_MIN).setMaxValue(PITCH_MAX)),
  async execute(i) {
    if (!await authorize(i)) return;
    const q = await needQueue(i);
    if (!q) return;
    const semitones = i.options.getInteger('semitones');
    q.pitch = semitones;
    store.set(i.guildId, { pitch: semitones });
    q.applyFilters();
    await reply(i, semitones === 0 ? 'Pitch reset to normal.' : `Pitch shifted **${semitones > 0 ? '+' : ''}${semitones}** semitones${q.current ? ' (playback briefly restarts)' : ''}.`);
  },
};

const { SlashCommandBuilder } = require('discord.js');
const store = require('../store');
const { LOUDNESS_LEVELS, DEFAULT_LOUDNESS_LEVEL } = require('../music/filters');
const { needQueue, reply, authorize } = require('./_util');

const LEVEL_TEXT = { soft: 'soft (−21 LUFS, default)', normal: 'normal (−18 LUFS)', loud: 'loud (−15 LUFS)' };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('normalize')
    .setDescription('Even out loudness so every song plays at the same volume (on by default)')
    .addBooleanOption((o) => o.setName('enabled').setDescription('Turn automatic loudness leveling on or off').setRequired(true))
    .addStringOption((o) => o.setName('level').setDescription(`How loud the leveled sound is (default: ${DEFAULT_LOUDNESS_LEVEL})`)
      .addChoices(...Object.keys(LOUDNESS_LEVELS).map((name) => ({ name: LEVEL_TEXT[name], value: name })))),
  async execute(i) {
    if (!await authorize(i)) return;
    const q = await needQueue(i);
    if (!q) return;
    q.autoNormalize = i.options.getBoolean('enabled');
    const level = i.options.getString('level');
    if (level) q.normalizeLevel = level;
    store.set(i.guildId, { levelingEnabled: q.autoNormalize, loudnessLevel: q.normalizeLevel });
    q.applyFilters();
    const state = q.autoNormalize ? `on, ${LEVEL_TEXT[q.normalizeLevel]}` : 'off (songs play at their original, uneven volume)';
    await reply(i, `Loudness leveling is **${state}**${q.current ? ' (playback briefly restarts)' : ''}.`);
  },
};

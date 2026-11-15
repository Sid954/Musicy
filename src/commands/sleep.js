const { SlashCommandBuilder } = require('discord.js');
const { needQueue, reply, authorize } = require('./_util');
const { MAX_SLEEP_MINUTES, describeSleep } = require('../music/sleep');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sleep')
    .setDescription('Stop and leave automatically after a while')
    .addSubcommand((s) => s.setName('in').setDescription('Leave after some minutes')
      .addIntegerOption((o) => o.setName('minutes').setDescription(`1 to ${MAX_SLEEP_MINUTES}`).setRequired(true).setMinValue(1).setMaxValue(MAX_SLEEP_MINUTES)))
    .addSubcommand((s) => s.setName('track').setDescription('Leave when the current track ends'))
    .addSubcommand((s) => s.setName('off').setDescription('Cancel the sleep timer'))
    .addSubcommand((s) => s.setName('status').setDescription('Show the sleep timer')),
  async execute(i) {
    const sub = i.options.getSubcommand();
    if (sub !== 'status' && !await authorize(i)) return;
    const q = await needQueue(i);
    if (!q) return;
    if (sub === 'status') {
      const text = describeSleep({ sleepAt: q.sleepAt, afterTrack: q.sleepAfterTrack });
      return reply(i, text || 'No sleep timer is set.', true);
    }
    if (sub === 'off') {
      q.clearSleep();
      q.refreshAnnouncement();
      return reply(i, 'Sleep timer cancelled.');
    }
    if (sub === 'track') {
      q.setSleep({ afterTrack: true });
      return reply(i, '😴 I will stop and leave when the current track ends.');
    }
    const minutes = i.options.getInteger('minutes');
    q.setSleep({ minutes });
    return reply(i, `😴 I will stop and leave in **${minutes} minute${minutes === 1 ? '' : 's'}**.`);
  },
};

const { SlashCommandBuilder } = require('discord.js');
const { needQueue, reply } = require('./_util');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('loop')
    .setDescription('Set loop mode')
    .addStringOption((o) =>
      o
        .setName('mode')
        .setDescription('Loop mode')
        .setRequired(true)
        .addChoices({ name: 'off', value: 'off' }, { name: 'track', value: 'track' }, { name: 'queue', value: 'queue' }),
    ),
  async execute(i) {
    const q = await needQueue(i);
    if (!q) return;
    q.loop = i.options.getString('mode');
    await reply(i, `Loop mode: **${q.loop}**`);
  },
};

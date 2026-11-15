const { SlashCommandBuilder } = require('discord.js');
const music = require('../music/player');
const historyOps = require('../music/history');
const embeds = require('../embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('replay')
    .setDescription('Replay a track from recent history')
    .addIntegerOption((o) => o.setName('position').setDescription('History position (1 is most recent)').setRequired(true).setMinValue(1).setMaxValue(25)),
  async execute(i) {
    const q = music.getQueue(i.guildId);
    const saved = historyOps.getHistoryTrack(q?.history, i.options.getInteger('position'));
    if (!saved) return i.reply({ embeds: [embeds.error('No track exists at that history position.')], ephemeral: true });
    const voiceChannel = i.member.voice.channel;
    if (!voiceChannel) return i.reply({ embeds: [embeds.error('Join a voice channel first.')], ephemeral: true });
    const botChannelId = i.guild.members.me?.voice?.channelId;
    if (botChannelId && botChannelId !== voiceChannel.id) {
      const channel = i.guild.channels.cache.get(botChannelId);
      return i.reply({ embeds: [embeds.error(`I’m already in ${channel || 'another voice channel'}.`)], ephemeral: true });
    }
    const track = historyOps.cloneReplay(saved);
    track.requestedBy = i.member.displayName;
    track.requestedById = i.user.id;
    const queue = music.getOrCreate(i.guildId, voiceChannel, i.channel);
    const startsNow = queue.enqueue([track]);
    await i.reply({ embeds: [startsNow ? embeds.nowPlaying(track) : embeds.queued(track, queue.tracks.length)], ephemeral: true });
  },
};

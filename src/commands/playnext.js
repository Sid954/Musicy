const { SlashCommandBuilder } = require('discord.js');
const music = require('../music/player');
const embeds = require('../embeds');
const { replyWithCard } = require('./_card');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('playnext')
    .setDescription('Play a song or playlist next')
    .addStringOption((o) => o.setName('query').setDescription('Search terms or YouTube URL').setRequired(true)),
  async execute(i) {
    const vc = i.member.voice.channel;
    if (!vc) return i.reply({ embeds: [embeds.error('Join a voice channel first.')], ephemeral: true });
    await i.deferReply();
    try {
      const tracks = await music.resolve(i.options.getString('query'));
      tracks.forEach((track) => { track.requestedBy = i.member.displayName; track.requestedById = i.user.id; });
      const q = music.getOrCreate(i.guildId, vc, i.channel);
      const wasIdle = !q.current && q.player.state.status === 'idle';
      q.playNext(tracks);
      if (wasIdle) q.advance(true);
      if (wasIdle) {
        await replyWithCard(i, q, tracks[0], { footer: tracks.length > 1 ? `+ ${tracks.length - 1} more tracks queued` : undefined });
        return;
      }
      const message = tracks.length > 1
        ? embeds.playlistQueued(tracks.length, tracks.reduce((sum, track) => sum + (track.duration || 0), 0), tracks[0])
        : embeds.queued(tracks[0], 1);
      await i.editReply({ embeds: [message] });
    } catch (error) {
      await i.editReply({ embeds: [embeds.error(`Could not play that: ${error.message}`)] });
    }
  },
};

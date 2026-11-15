const { SlashCommandBuilder } = require('discord.js');
const music = require('../music/player');
const playlists = require('../music/playlist-store');
const embeds = require('../embeds');
const { replyWithCard } = require('./_card');
const { loadSavedTracks } = require('../music/saved-track');
const { promptCollection } = require('./_collection-prompt');

module.exports = {
  data: new SlashCommandBuilder().setName('favorites').setDescription('Play your saved favorite tracks'),
  async execute(i) {
    const voiceChannel = i.member.voice.channel;
    if (!voiceChannel) return i.reply({ embeds: [embeds.error('Join a voice channel first.')], ephemeral: true });
    const botChannelId = i.guild.members.me?.voice?.channelId;
    if (botChannelId && botChannelId !== voiceChannel.id) return i.reply({ embeds: [embeds.error('I’m already in another voice channel.')], ephemeral: true });
    const saved = playlists.get(i.user.id, 'favorites') || [];
    if (!saved.length) return i.reply({ embeds: [embeds.error('Your favorites are empty.')], ephemeral: true });
    await i.deferReply();
    try {
      const tracks = await loadSavedTracks(saved, { resolve: music.resolve });
      if (tracks.length > 1) return await promptCollection(i, tracks, { title: 'Your favorites', kind: 'Favorites', allowSave: false });
      tracks.forEach((track) => { track.requestedBy = i.member.displayName; track.requestedById = i.user.id; });
      const q = music.getOrCreate(i.guildId, voiceChannel, i.channel);
      const startsNow = q.enqueue(tracks);
      if (startsNow) { await replyWithCard(i, q, tracks[0]); return; }
      await i.editReply({ embeds: [embeds.queued(tracks[0], q.tracks.length)] });
    } catch (error) {
      await i.editReply({ embeds: [embeds.error(`Could not play favorites: ${error.message}`)] });
    }
  },
};

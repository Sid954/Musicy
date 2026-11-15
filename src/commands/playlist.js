const { SlashCommandBuilder } = require('discord.js');
const music = require('../music/player');
const embeds = require('../embeds');
const { replyWithCard } = require('./_card');
const playlistStore = require('../music/playlist-store');
const { loadSavedTracks } = require('../music/saved-track');
const { promptCollection } = require('./_collection-prompt');
const { showPaginatedList } = require('../music/list-view');

const nameOption = (option) => option.setName('name').setDescription('Playlist name (1–32 characters)').setRequired(true).setMaxLength(32);
const data = new SlashCommandBuilder().setName('playlist').setDescription('Manage your personal playlists')
  .addSubcommand((sub) => sub.setName('create').setDescription('Create a playlist').addStringOption(nameOption))
  .addSubcommand((sub) => sub.setName('delete').setDescription('Delete a playlist').addStringOption(nameOption))
  .addSubcommand((sub) => sub.setName('list').setDescription('List your playlists'))
  .addSubcommand((sub) => sub.setName('show').setDescription('Show playlist tracks').addStringOption(nameOption))
  .addSubcommand((sub) => sub.setName('add').setDescription('Add tracks from a query or URL').addStringOption(nameOption).addStringOption((o) => o.setName('query').setDescription('Search or URL').setRequired(true).setAutocomplete(true)))
  .addSubcommand((sub) => sub.setName('remove').setDescription('Remove a playlist track').addStringOption(nameOption).addIntegerOption((o) => o.setName('position').setDescription('Track position').setRequired(true).setMinValue(1)))
  .addSubcommand((sub) => sub.setName('play').setDescription('Play a playlist').addStringOption(nameOption))
  .addSubcommand((sub) => sub.setName('save-queue').setDescription('Save the current queue').addStringOption(nameOption));

module.exports = {
  data,
  async autocomplete(i) {
    const choices = await require('../music/autocomplete').suggest(i.options.getFocused());
    await i.respond(choices.map((value) => ({ name: value, value })));
  },
  async execute(i) {
    const userId = i.user.id;
    const action = i.options.getSubcommand();
    const name = i.options.getString('name');
    try {
      if (action === 'create') {
        playlistStore.create(userId, name);
        return i.reply({ embeds: [embeds.info(`Created playlist **${name}**.`)], ephemeral: true });
      }
      if (action === 'delete') {
        playlistStore.delete(userId, name);
        return i.reply({ embeds: [embeds.info(`Deleted playlist **${name}**.`)], ephemeral: true });
      }
      if (action === 'list') {
        const lists = playlistStore.list(userId);
        return i.reply({ embeds: [embeds.info(lists.length ? lists.map((item) => `• **${item}** (${playlistStore.get(userId, item).length} tracks)`).join('\n') : 'You have no playlists.')], ephemeral: true });
      }
      if (action === 'show') {
        const tracks = playlistStore.get(userId, name);
        if (!tracks) throw new Error('Playlist not found.');
        return showPaginatedList(i, {
          title: `Playlist: ${name}`,
          items: tracks,
          prefix: 'playlist-show',
          perPage: 10,
          emptyText: 'This playlist is empty.',
          formatItem: (track) => `**${String(track.title || 'Unknown').replace(/[\\[\\]`*_]/g, '')}** · ${embeds.fmt(track.duration)}`,
        });
      }
      if (action === 'remove') {
        playlistStore.remove(userId, name, i.options.getInteger('position'));
        return i.reply({ embeds: [embeds.info('Removed that track from the playlist.')], ephemeral: true });
      }
      if (action === 'add') {
        await i.deferReply({ ephemeral: true });
        const tracks = await music.resolve(i.options.getString('query'));
        playlistStore.add(userId, name, tracks);
        return i.editReply({ embeds: [embeds.info(`Added ${tracks.length} track${tracks.length === 1 ? '' : 's'} to **${name}**.`)] });
      }
      if (action === 'save-queue') {
        const q = music.getQueue(i.guildId);
        if (!q || (!q.current && !q.tracks.length)) throw new Error('The queue is empty.');
        playlistStore.add(userId, name, [...(q.current ? [q.current] : []), ...q.tracks]);
        return i.reply({ embeds: [embeds.info(`Saved the queue to **${name}**.`)], ephemeral: true });
      }
      if (action === 'play') {
        const voiceChannel = i.member.voice.channel;
        if (!voiceChannel) throw new Error('Join a voice channel first.');
        const botChannelId = i.guild.members.me?.voice?.channelId;
        if (botChannelId && botChannelId !== voiceChannel.id) throw new Error('I’m already in another voice channel.');
        await i.deferReply();
        const saved = playlistStore.get(userId, name);
        if (!saved) throw new Error('Playlist not found.');
        if (!saved.length) throw new Error('That playlist is empty.');
        const tracks = await loadSavedTracks(saved, { resolve: music.resolve });
        if (tracks.length > 1) return await promptCollection(i, tracks, { title: name, kind: 'Saved', allowSave: false });
        tracks.forEach((track) => { track.requestedBy = i.member.displayName; track.requestedById = i.user.id; });
        const q = music.getOrCreate(i.guildId, voiceChannel, i.channel);
        const startsNow = q.enqueue(tracks);
        if (startsNow) return replyWithCard(i, q, tracks[0]);
        return i.editReply({ embeds: [embeds.queued(tracks[0], q.tracks.length)] });
      }
    } catch (error) {
      const response = { embeds: [embeds.error(error.message)], ephemeral: true };
      if (i.deferred || i.replied) return i.followUp(response).catch(() => {});
      return i.reply(response);
    }
  },
};

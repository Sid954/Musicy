const { SlashCommandBuilder } = require('discord.js');
const music = require('../music/player');
const embeds = require('../embeds');
const log = require('../log');
const { replyWithCard } = require('./_card');
const { RESULT_COUNT, buildSearchEmbed, buildSearchRows } = require('../music/search-view');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('search')
    .setDescription('Search YouTube or SoundCloud and pick a result')
    .addStringOption((o) => o.setName('query').setDescription('Search terms').setRequired(true))
    .addStringOption((o) => o.setName('source').setDescription('Where to search').addChoices(
      { name: 'YouTube', value: 'youtube' },
      { name: 'SoundCloud', value: 'soundcloud' },
    )),
  async execute(i) {
    if (!i.member.voice.channel) return i.reply({ embeds: [embeds.error('Join a voice channel first.')], ephemeral: true });
    await i.deferReply();

    let tracks;
    const query = i.options.getString('query');
    const source = i.options.getString('source') || 'youtube';
    const searchQuery = source === 'soundcloud' ? `scsearch16:${query}` : query;
    let page = 0;
    try {
      tracks = (await music.resolveMany(searchQuery, 16)).slice(0, 16);
      if (!tracks.length) throw new Error('No results found.');
      const visible = tracks.slice(0, RESULT_COUNT);
      await i.editReply({ embeds: [buildSearchEmbed(query, visible, { source })], components: buildSearchRows(visible.length, { hasNext: tracks.length > RESULT_COUNT }) });
    } catch (error) {
      return i.editReply({ embeds: [embeds.error(`Search failed: ${error.message}`)], components: [] });
    }

    const message = await i.fetchReply();
    const collector = message.createMessageComponentCollector({ time: 60_000, filter: (c) => c.customId.startsWith('search:') });
    collector.on('collect', async (c) => {
      try {
        if (c.user.id !== i.user.id) {
          await c.reply({ embeds: [embeds.error(`Only ${i.member.displayName} can pick from this search.`)], ephemeral: true });
          return;
        }
        if (c.customId === 'search:cancel') {
          collector.stop('done');
          await c.update({ embeds: [embeds.info('Search cancelled.')], components: [] });
          return;
        }
        if (c.customId === 'search:next' || c.customId === 'search:previous') {
          page = c.customId === 'search:next' ? 1 : 0;
          await c.deferUpdate();
          const visible = tracks.slice(page * RESULT_COUNT, (page + 1) * RESULT_COUNT);
          await c.editReply({ embeds: [buildSearchEmbed(query, visible, { page, source })], components: buildSearchRows(visible.length, { page, hasNext: page === 0 && tracks.length > RESULT_COUNT }) });
          return;
        }
        const queueAll = c.customId === 'search:queue';
        const selected = queueAll ? tracks : [tracks[Number(c.customId.slice('search:'.length))]];
        if (!selected.length || selected.some((track) => !track)) return;

        const userChannel = c.member.voice?.channel;
        if (!userChannel) {
          await c.reply({ embeds: [embeds.error('Join a voice channel first.')], ephemeral: true });
          return;
        }
        // Same rule as /play: the bot may be idle (not in a channel yet), but not in a different one.
        const botChannelId = c.guild.members.me?.voice?.channelId;
        if (botChannelId && botChannelId !== userChannel.id) {
          await c.reply({ embeds: [embeds.error(`I’m already in <#${botChannelId}>. Join it first.`)], ephemeral: true });
          return;
        }

        await c.deferUpdate(); // acknowledge inside Discord's 3s window before doing any work
        for (const track of selected) {
          track.requestedBy = c.member.displayName;
          track.requestedById = c.user.id;
        }
        const queue = music.getOrCreate(c.guildId, userChannel, c.channel);
        const position = queue.tracks.length + (queue.current ? 1 : 0);
        const startsNow = queue.enqueue(selected);
        collector.stop('done');
        if (startsNow) {
          await replyWithCard(c, queue, selected[0], { footer: selected.length > 1 ? `+ ${selected.length - 1} more tracks queued` : undefined });
        } else {
          const reply = queueAll
            ? embeds.info(`Queued **${selected.length} tracks** starting at position **${position}**.`)
            : embeds.queued(selected[0], position);
          await c.editReply({ embeds: [reply], components: [] });
        }
      } catch (error) {
        log.error('Search pick failed:', error);
        const reply = { embeds: [embeds.error(`Could not queue that: ${error.message}`)], components: [] };
        if (c.deferred || c.replied) await c.editReply(reply).catch(() => {});
        else await c.reply({ ...reply, ephemeral: true }).catch(() => {});
      }
    });
    collector.on('end', (_collected, reason) => {
      if (reason === 'done') return;
      const visible = tracks.slice(page * RESULT_COUNT, (page + 1) * RESULT_COUNT);
      i.editReply({ embeds: [buildSearchEmbed(query, visible, { expired: true, page, source })], components: buildSearchRows(visible.length, { page, disabled: true }) }).catch(() => {});
    });
  },
};

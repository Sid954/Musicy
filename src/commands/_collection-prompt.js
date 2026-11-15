// Shown instead of silently queueing when a query returns several tracks (playlist, mix, album, saved list).
// Offers: play all, shuffle, first song only, first N (modal), play next, shuffle & next, skip duplicates, save, cancel.
const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const music = require('../music/player');
const embeds = require('../embeds');
const log = require('../log');
const { replyWithCard } = require('./_card');
const playlistStore = require('../music/playlist-store');
const store = require('../store');
const { summarize, uniquePlaylistName, parseCount, prepareSelection } = require('../music/collection');
const { buildCollectionEmbed, buildCollectionRows } = require('../music/collection-view');

// mode: ordering; next: insert at the front of the queue instead of the end.
const ACTIONS = {
  order: { mode: 'order' },
  shuffle: { mode: 'shuffle', note: 'shuffled' },
  first: { mode: 'first', count: 1 },
  firstn: { mode: 'order' },
  next: { mode: 'order', next: true, note: 'playing next' },
  shufflenext: { mode: 'shuffle', next: true, note: 'shuffled · playing next' },
};

// `i` must already be replied/deferred. Resolves once the prompt is shown; choices are handled by a collector.
async function promptCollection(i, tracks, { title, allowSave = true, kind } = {}) {
  let savedAs = null;
  let skipDuplicates = false;
  const rows = (extra = {}) => buildCollectionRows({ allowSave, saved: Boolean(savedAs), skipDuplicates, ...extra });

  // How many more tracks this server's queue limit allows, and the longest single track it accepts.
  const limits = (guildId) => {
    const settings = store.get(guildId);
    const queue = music.getQueue(guildId);
    const used = queue ? queue.tracks.length + (queue.current ? 1 : 0) : 0;
    return { room: Math.max(0, (settings.maxQueueLength ?? 500) - used), maxDuration: settings.maxTrackDuration ?? 0 };
  };

  await i.editReply({ embeds: [buildCollectionEmbed(tracks, { title, kind, room: limits(i.guildId).room })], components: rows() });
  const message = await i.fetchReply();
  const collector = message.createMessageComponentCollector({ time: 60_000, filter: (c) => c.customId.startsWith('collection:') });

  // `ix` is the component (or modal-submit) interaction that carries the user's choice.
  async function addTracks(ix, action, count = 0) {
    const spec = ACTIONS[action];
    const userChannel = ix.member.voice?.channel;
    if (!userChannel) return ix.reply({ embeds: [embeds.error('Join a voice channel first.')], ephemeral: true });
    const botChannelId = ix.guild.members.me?.voice?.channelId;
    if (botChannelId && botChannelId !== userChannel.id) {
      return ix.reply({ embeds: [embeds.error(`I’m already in <#${botChannelId}>. Join it first.`)], ephemeral: true });
    }

    const existingQueue = music.getQueue(ix.guildId);
    const { room, maxDuration } = limits(ix.guildId);
    if (room <= 0) return ix.reply({ embeds: [embeds.error('The queue is full. Remove some tracks first.')], ephemeral: true });
    const { chosen, skipped, tooLong, trimmed } = prepareSelection(tracks, {
      mode: spec.mode,
      count: spec.count || count,
      skipDuplicates,
      existing: existingQueue ? [existingQueue.current, ...existingQueue.tracks] : [],
      limit: room,
      maxDuration,
    });
    if (!chosen.length) {
      const reason = tooLong ? `Those tracks are all longer than this server's ${Math.round(maxDuration / 60)}-minute limit.` : 'Everything in this selection is already in the queue.';
      return ix.reply({ embeds: [embeds.error(reason)], ephemeral: true });
    }

    await ix.deferUpdate(); // acknowledge before the (slower) queue work
    chosen.forEach((track) => { track.requestedBy = ix.member.displayName; track.requestedById = ix.user.id; });

    const queue = music.getOrCreate(ix.guildId, userChannel, ix.channel);
    const position = queue.tracks.length + (queue.current ? 1 : 0);
    let startsNow;
    if (spec.next) {
      const wasIdle = !queue.current && queue.player.state.status === 'idle';
      queue.playNext(chosen);
      if (wasIdle) queue.advance(true);
      startsNow = wasIdle;
    } else {
      startsNow = queue.enqueue(chosen);
    }
    collector.stop('done');

    const notes = [
      chosen.length > 1 && startsNow ? `+ ${chosen.length - 1} more tracks queued` : null,
      action === 'firstn' ? `first ${chosen.length}` : spec.note,
      skipped ? `skipped ${skipped} duplicate${skipped === 1 ? '' : 's'}` : null,
      tooLong ? `skipped ${tooLong} over the length limit` : null,
      trimmed ? `limited to ${chosen.length} by the queue limit` : null,
    ].filter(Boolean).join(' · ') || undefined;
    if (startsNow) {
      await replyWithCard(ix, queue, chosen[0], { footer: notes });
      return;
    }
    const total = chosen.reduce((sum, track) => sum + (track.duration || 0), 0);
    const embed = chosen.length > 1
      ? embeds.playlistQueued(chosen.length, total, chosen[0], notes)
      : embeds.queued(chosen[0], spec.next ? 1 : position);
    await ix.editReply({ embeds: [embed], components: [] });
  }

  async function askCount(c) {
    const modal = new ModalBuilder().setCustomId('collection:modal').setTitle('How many tracks?').addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('count').setLabel(`First how many tracks? (1 - ${tracks.length})`)
          .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(4).setPlaceholder('e.g. 20'),
      ),
    );
    await c.showModal(modal);
    const submitted = await c.awaitModalSubmit({ time: 60_000, filter: (m) => m.customId === 'collection:modal' && m.user.id === c.user.id }).catch(() => null);
    if (!submitted) return;
    const count = parseCount(submitted.fields.getTextInputValue('count'), tracks.length);
    if (!count) {
      await submitted.reply({ embeds: [embeds.error(`Enter a whole number from 1 to ${tracks.length}.`)], ephemeral: true });
      return;
    }
    await addTracks(submitted, 'firstn', count);
  }

  collector.on('collect', async (c) => {
    try {
      if (c.user.id !== i.user.id) {
        await c.reply({ embeds: [embeds.error(`Only ${i.member.displayName} can choose here.`)], ephemeral: true });
        return;
      }
      // Buttons carry the action in their customId; the "More ways to add…" drop-down carries it in its value.
      const action = c.customId === 'collection:more' ? c.values?.[0] : c.customId.slice('collection:'.length);

      if (action === 'cancel') {
        collector.stop('done');
        await c.update({ embeds: [embeds.info('Cancelled. Nothing was added.')], components: [] });
        return;
      }
      if (action === 'dedupe') {
        skipDuplicates = !skipDuplicates;
        await c.update({ components: rows() });
        return;
      }
      if (action === 'save') {
        if (savedAs) {
          await c.reply({ embeds: [embeds.info(`Already saved as **${savedAs}**.`)], ephemeral: true });
          return;
        }
        const name = uniquePlaylistName(title || summarize(tracks).title || 'Saved playlist', playlistStore.list(c.user.id));
        playlistStore.create(c.user.id, name);
        try {
          playlistStore.add(c.user.id, name, tracks);
        } catch (error) {
          playlistStore.delete(c.user.id, name); // don't leave an empty playlist behind
          throw error;
        }
        savedAs = name;
        await c.update({ components: rows() });
        await c.followUp({ embeds: [embeds.info(`Saved ${tracks.length} tracks as **${name}**. Play it any time with \`/playlist play\`.`)], ephemeral: true });
        return;
      }
      if (action === 'firstn') {
        await askCount(c);
        return;
      }
      if (ACTIONS[action]) await addTracks(c, action);
    } catch (error) {
      log.error('Playlist prompt failed:', error);
      const reply = { embeds: [embeds.error(error.message || 'Something went wrong.')], components: [] };
      if (c.deferred || c.replied) await c.editReply(reply).catch(() => {});
      else await c.reply({ ...reply, ephemeral: true }).catch(() => {});
    }
  });

  collector.on('end', (_collected, reason) => {
    if (reason === 'done') return;
    i.editReply({ embeds: [buildCollectionEmbed(tracks, { title, expired: true })], components: rows({ disabled: true }) }).catch(() => {});
  });
}

module.exports = { promptCollection, ACTIONS };

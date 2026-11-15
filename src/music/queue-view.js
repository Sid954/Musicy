// Paginated queue view: builders are pure (tested); showQueue wires them to a Discord interaction.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { pageSlice, pageCount, clampPage, pageFromAction, linkText } = require('./pager');
const { progressBar } = require('./progress');
const { formatTotal } = require('./collection');
const embeds = require('../embeds');
const log = require('../log');

const PER_PAGE = 10;
const COLOR = 0x5865f2;

const link = (track, max) => (track.url ? `[${linkText(track.title || 'Unknown', max)}](${track.url})` : linkText(track.title || 'Unknown', max));

function buildQueueEmbed({ current, tracks, page = 0, elapsed = 0, loop = 'off', autoplay = false }) {
  const view = pageSlice(tracks, page, PER_PAGE);
  const lines = view.items.map((track, index) => `\`${String(view.start + index + 1).padStart(2, ' ')}.\` ${link(track, 52)} · \`${embeds.fmt(track.duration)}\``);

  let nowPlaying = '**Nothing is playing right now.**';
  if (current) {
    const bar = current.isLive || !current.duration
      ? '🔴 LIVE'
      : `${progressBar(elapsed, current.duration)} \`${embeds.fmt(elapsed)} / ${embeds.fmt(current.duration)}\``;
    nowPlaying = `**Now playing**\n${link(current, 70)}\n${bar}${current.requestedBy ? ` · requested by ${current.requestedBy}` : ''}`;
  }
  const heading = view.pages > 1 ? `**Up next** · page ${view.page + 1}/${view.pages}` : '**Up next**';
  const upNext = lines.length ? lines.join('\n') : '*Nothing queued after this track.*';

  const remaining = tracks.reduce((sum, track) => sum + (track.duration > 0 ? track.duration : 0), 0);
  const footer = [`${tracks.length} queued`, tracks.length ? `${formatTotal(remaining)} remaining` : null, `Loop: ${loop}`, autoplay ? 'Autoplay on' : null]
    .filter(Boolean).join(' · ');

  const embed = new EmbedBuilder().setColor(COLOR).setTitle('Queue').setDescription(`${nowPlaying}\n\n${heading}\n${upNext}`).setFooter({ text: footer });
  if (current?.thumbnail) embed.setThumbnail(current.thumbnail);
  return embed;
}

function buildQueueRows(page, pages, disabled = false) {
  if (pages <= 1) return [];
  const button = (id, label, isDisabled, style = ButtonStyle.Secondary) =>
    new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled || isDisabled);
  return [new ActionRowBuilder().addComponents(
    button('queue:first', '⏮ First', page <= 0),
    button('queue:prev', '◀ Prev', page <= 0, ButtonStyle.Primary),
    button('queue:page', `${page + 1} / ${pages}`, true),
    button('queue:next', 'Next ▶', page >= pages - 1, ButtonStyle.Primary),
    button('queue:last', 'Last ⏭', page >= pages - 1),
  )];
}

function buildQueueActionRows({ page, tracks, loop = 'off', autoplay = false, disabled = false }) {
  const rows = [];
  if (tracks.length > 0) {
    const start = page * PER_PAGE;
    const options = tracks.slice(start, start + PER_PAGE).map((track, offset) => ({
      label: `${start + offset + 1}. ${track.title || 'Unknown'}`.slice(0, 100),
      value: String(start + offset + 1),
      description: `${embeds.fmt(track.duration)} · ${track.author || 'Unknown'}`.slice(0, 100),
    }));
    if (options.length) rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId('queue:select').setPlaceholder('Select a track on this page')
        .setMinValues(1).setMaxValues(1).setOptions(options).setDisabled(disabled),
    ));
  }
  if (tracks.length > 0) {
    const button = (action, label, style = ButtonStyle.Secondary) => new ButtonBuilder()
      .setCustomId(`queue:track:${action}`).setLabel(label).setStyle(style).setDisabled(disabled);
    rows.push(new ActionRowBuilder().addComponents(
      button('remove', 'Remove', ButtonStyle.Danger),
      button('play', 'Play now', ButtonStyle.Primary),
      button('top', 'Move to top'),
    ));
  }
  const button = (action, label, style = ButtonStyle.Secondary, isDisabled = false) => new ButtonBuilder()
    .setCustomId(`queue:action:${action}`).setLabel(label).setStyle(style).setDisabled(disabled || isDisabled);
  rows.push(new ActionRowBuilder().addComponents(
    button('shuffle', 'Shuffle'),
    button('clear', 'Clear', ButtonStyle.Danger),
    button('loop', `Loop: ${loop}`),
    button('autoplay', `Autoplay: ${autoplay ? 'On' : 'Off'}`),
  ));
  return rows;
}

// Posts the queue as a browsable embed. Everything is re-read from the live queue on every click.
async function showQueue(interaction, { ephemeral = false } = {}) {
  const music = require('./player'); // lazy: player.js is a large module with its own dependencies
  const store = require('../store');
  const { canUse } = require('./permissions');
  let page = 0;
  let selectedTrack = null;
  let selectedBy = null;

  const render = (disabled = false) => {
    const q = music.getQueue(interaction.guildId);
    if (!q || (!q.current && !q.tracks.length)) return { embeds: [embeds.error('The queue is empty.')], components: [] };
    page = clampPage(page, q.tracks.length, PER_PAGE);
    return {
      embeds: [buildQueueEmbed({ current: q.current, tracks: q.tracks, page, elapsed: q.getElapsedSeconds(), loop: q.loop, autoplay: q.autoplay })],
      components: [
        ...buildQueueRows(page, pageCount(q.tracks.length, PER_PAGE), disabled),
        ...buildQueueActionRows({ page, tracks: q.tracks, loop: q.loop, autoplay: q.autoplay, disabled }),
      ],
    };
  };

  const first = render();
  await interaction.reply({ ...first, ephemeral });
  if (!first.components.length) return;

  const message = await interaction.fetchReply();
  const collector = message.createMessageComponentCollector({ time: 120_000, filter: (c) => c.customId.startsWith('queue:') });
  collector.on('collect', async (c) => {
    try {
      await c.deferUpdate();
      const q = music.getQueue(interaction.guildId);
      if (!q) return;
      const settings = store.get(interaction.guildId);
      const command = c.customId === 'queue:select' ? null
        : c.customId.startsWith('queue:action:') ? c.customId.slice('queue:action:'.length)
          : c.customId.startsWith('queue:track:') ? c.customId.slice('queue:track:'.length) : null;
      const restricted = { shuffle: 'shuffle', clear: 'clear', loop: 'shuffle', autoplay: 'autoplay', remove: 'remove', play: 'skipto', top: 'move' };
      if (command && !canUse(c.member, restricted[command], settings, c.channelId)) {
        await c.followUp({ content: 'You need the configured DJ role or Manage Server permission to change the queue.', ephemeral: true });
        return;
      }
      if (c.customId === 'queue:select') {
        const position = Number(c.values?.[0]);
        if (!Number.isInteger(position) || position < page * PER_PAGE + 1 || position > Math.min((page + 1) * PER_PAGE, q.tracks.length)) {
          await c.followUp({ content: 'That track is no longer on this queue page.', ephemeral: true });
          return;
        }
        selectedTrack = q.tracks[position - 1] || null;
        selectedBy = c.user.id;
        await interaction.editReply(render());
        return;
      }
      if (c.customId.startsWith('queue:action:')) {
        const action = c.customId.slice('queue:action:'.length);
        if (action === 'shuffle') { q.shuffle(); selectedTrack = null; selectedBy = null; }
        else if (action === 'clear') { q.clearQueue(); selectedTrack = null; selectedBy = null; }
        else if (action === 'loop') q.loop = ['off', 'track', 'queue'][(['off', 'track', 'queue'].indexOf(q.loop) + 1) % 3];
        else if (action === 'autoplay') {
          q.autoplay = !q.autoplay;
          q.autoplaySuppressed = false;
          store.set(interaction.guildId, { autoplay: q.autoplay });
          if (q.autoplay && !q.current && !q.tracks.length && q.lastTrack) q.advance();
        }
      } else if (selectedTrack && c.customId.startsWith('queue:track:')) {
        if (c.user.id !== selectedBy) {
          await c.followUp({ content: 'Select a queue track on this view before using these actions.', ephemeral: true });
          return;
        }
        const selected = q.tracks.indexOf(selectedTrack) + 1;
        selectedTrack = null;
        selectedBy = null;
        if (!selected) {
          await c.followUp({ content: 'That track is no longer in the queue.', ephemeral: true });
          return;
        }
        const action = c.customId.slice('queue:track:'.length);
        if (action === 'play' && c.member?.voice?.channelId !== q.voiceChannelId) {
          await c.followUp({ content: 'Join my voice channel to play a selected track now.', ephemeral: true });
          return;
        }
        if (action === 'remove') q.remove(selected);
        else if (action === 'play') q.skipTo(selected);
        else if (action === 'top') q.move(selected, 1);
      } else if (['first', 'prev', 'next', 'last'].includes(c.customId.slice('queue:'.length))) {
        selectedTrack = null;
        selectedBy = null;
        page = pageFromAction(c.customId.slice('queue:'.length), page, pageCount(q.tracks.length, PER_PAGE));
      }
      page = clampPage(page, q.tracks.length, PER_PAGE);
      await interaction.editReply(render());
    } catch (error) {
      log.error('Queue component failed:', error);
      const response = { content: 'Could not update the queue. Please try again.', ephemeral: true };
      if (c.deferred || c.replied) await c.followUp(response).catch(() => {});
      else await c.reply(response).catch(() => {});
    }
  });
  collector.on('end', () => { interaction.editReply(render(true)).catch(() => {}); });
}

module.exports = { PER_PAGE, buildQueueEmbed, buildQueueRows, buildQueueActionRows, showQueue };

// /search result card: numbered list + number buttons (4 per row) + paging and queue actions.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { linkText, clip } = require('./pager');
const embeds = require('../embeds');

const RESULT_COUNT = 8;
const PER_ROW = 4;

function buildSearchEmbed(query, tracks, { expired = false, page = 0, source = 'youtube' } = {}) {
  const offset = page * RESULT_COUNT;
  const lines = tracks.map((track, index) => {
    const title = track.url ? `[${linkText(track.title || 'Unknown', 70)}](${track.url})` : linkText(track.title || 'Unknown', 70);
    return `**${offset + index + 1}.** ${title}\n└ ${clip(track.author || 'Unknown', 40)} · \`${embeds.fmt(track.duration)}\``;
  });
  return new EmbedBuilder()
    .setColor(expired ? 0x747f8d : 0x5865f2)
    .setTitle(`🔎 Results for “${clip(query, 80)}”`)
    .setDescription(lines.join('\n\n'))
    .setFooter({ text: expired ? 'This search expired.' : `${source === 'soundcloud' ? 'SoundCloud' : 'YouTube'} · page ${page + 1} · Press a number to play · expires in 60s` });
}

function buildSearchRows(count, { page = 0, hasNext = false, disabled = false } = {}) {
  const rows = [];
  for (let start = 0; start < count; start += PER_ROW) {
    const row = new ActionRowBuilder();
    for (let n = start; n < Math.min(count, start + PER_ROW); n++) {
      row.addComponents(new ButtonBuilder().setCustomId(`search:${page * RESULT_COUNT + n}`).setLabel(String(page * RESULT_COUNT + n + 1)).setStyle(ButtonStyle.Primary).setDisabled(disabled));
    }
    rows.push(row);
  }
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('search:previous').setLabel('Previous').setStyle(ButtonStyle.Secondary).setDisabled(disabled || page === 0),
    new ButtonBuilder().setCustomId(`search:page:${page + 1}`).setLabel(`${page + 1} / 2`).setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId('search:next').setLabel('Next').setStyle(ButtonStyle.Secondary).setDisabled(disabled || !hasNext || page > 0),
    new ButtonBuilder().setCustomId('search:queue').setLabel('Queue all').setStyle(ButtonStyle.Success).setDisabled(disabled),
    new ButtonBuilder().setCustomId('search:cancel').setLabel('Cancel').setStyle(ButtonStyle.Danger).setDisabled(disabled),
  ));
  return rows;
}

module.exports = { RESULT_COUNT, PER_ROW, buildSearchEmbed, buildSearchRows };

// Prompt shown when a query resolves to several tracks (playlist, mix, album, saved playlist).
// Layout: stats line + clean preview, then ONE row of main actions and ONE drop-down for the rarer ways to add.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { clip, linkText } = require('./pager');
const { summarize, formatTotal } = require('./collection');
const { displayTitle } = require('./title');
const { fmt } = require('./format');
const { PLAYLIST_LIMIT } = require('./sources/youtube');

const PREVIEW = 6;
const TITLE_WIDTH = 46;

// "YouTube", "Spotify" or an explicit kind such as "Saved" / "Favorites".
function sourceLabel(tracks, kind) {
  if (kind) return kind;
  return tracks.some((track) => track.source === 'spotify' || track.spotifyQuery) ? 'Spotify' : 'YouTube';
}

// `room`: how many more tracks the server's queue limit allows (omit when unknown).
function buildCollectionEmbed(tracks, { title, kind, room, expired = false } = {}) {
  const summary = summarize(tracks);
  const average = summary.count && summary.totalSeconds ? Math.round(summary.totalSeconds / summary.count) : 0;

  const stats = [
    `🎵 **${summary.count}** track${summary.count === 1 ? '' : 's'}`,
    summary.totalSeconds ? `⏱ **${formatTotal(summary.totalSeconds)}**` : null,
    average ? `avg ${fmt(average)}` : null,
    summary.liveCount ? `🔴 ${summary.liveCount} live` : null,
  ].filter(Boolean).join('  ·  ');

  const preview = tracks.slice(0, PREVIEW).map((track, index) => `**${index + 1}.** ${linkText(displayTitle(track.title), TITLE_WIDTH)} · ${fmt(track.duration)}`);
  if (tracks.length > PREVIEW) preview.push(`*…and ${tracks.length - PREVIEW} more*`);

  const lines = [stats, '', ...preview];
  if (!expired && Number.isFinite(room) && room < tracks.length) {
    lines.push('', room > 0
      ? `⚠️ This server's queue limit leaves room for **${room}** more track${room === 1 ? '' : 's'}; only the first ${room} will be added.`
      : '⚠️ The queue is full, so nothing can be added right now.');
  }

  const footer = [expired ? 'This prompt expired.' : 'Pick how to add it · expires in 60s'];
  if (summary.count >= PLAYLIST_LIMIT) footer.push(`only the first ${PLAYLIST_LIMIT} tracks were loaded`);

  const embed = new EmbedBuilder()
    .setColor(expired ? 0x747f8d : 0x5865f2)
    .setAuthor({ name: `📃 ${sourceLabel(tracks, kind)} playlist` })
    .setTitle(clip(title || summary.title || `${summary.count} tracks`, 200))
    .setDescription(lines.join('\n'))
    .setFooter({ text: footer.join(' · ') });
  if (tracks[0]?.thumbnail) embed.setThumbnail(tracks[0].thumbnail);
  return embed;
}

// Less common ways to add the tracks, tucked into a drop-down (values are collection actions).
const MORE_OPTIONS = Object.freeze([
  { value: 'first', label: 'First song only', emoji: '🎵', description: 'Just the first track of the playlist' },
  { value: 'firstn', label: 'First N tracks…', emoji: '🔢', description: 'Type how many to add' },
  { value: 'next', label: 'Play next', emoji: '⏭', description: 'Put them at the front of the queue' },
  { value: 'shufflenext', label: 'Shuffle & play next', emoji: '🔀', description: 'Shuffled, at the front of the queue' },
]);

function buildCollectionRows({ disabled = false, allowSave = true, saved = false, skipDuplicates = false } = {}) {
  const button = (id, { label, emoji, style = ButtonStyle.Secondary, off = false }) =>
    new ButtonBuilder().setCustomId(`collection:${id}`).setLabel(label).setEmoji(emoji).setStyle(style).setDisabled(disabled || off);
  const main = [
    button('order', { label: 'Play all', emoji: '▶️', style: ButtonStyle.Success }),
    button('shuffle', { label: 'Shuffle', emoji: '🔀', style: ButtonStyle.Primary }),
    button('dedupe', { label: skipDuplicates ? 'No duplicates' : 'Skip duplicates', emoji: skipDuplicates ? '✅' : '♻️', style: skipDuplicates ? ButtonStyle.Success : ButtonStyle.Secondary }),
  ];
  if (allowSave) main.push(button('save', { label: saved ? 'Saved' : 'Save', emoji: saved ? '✅' : '💾', off: saved }));
  main.push(button('cancel', { label: 'Cancel', emoji: '✖️', style: ButtonStyle.Danger }));

  const more = new StringSelectMenuBuilder()
    .setCustomId('collection:more')
    .setPlaceholder('More ways to add…')
    .setDisabled(disabled)
    .addOptions(MORE_OPTIONS.map((option) => ({ ...option })));
  return [new ActionRowBuilder().addComponents(...main), new ActionRowBuilder().addComponents(more)];
}

module.exports = { PREVIEW, MORE_OPTIONS, sourceLabel, buildCollectionEmbed, buildCollectionRows };

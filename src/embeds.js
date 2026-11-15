const { EmbedBuilder } = require('discord.js');

const COLOR = 0x5865f2;
const OK = 0x57f287;
const ERR = 0xed4245;
const { fmt } = require('./music/format');


const trackFields = (t) => [
  { name: 'Duration', value: fmt(t.duration), inline: true },
  { name: 'Channel', value: t.author || 'Unknown', inline: true },
  ...(t.requestedBy ? [{ name: 'Requested by', value: t.requestedBy, inline: true }] : []),
];

// Thin wrappers over the single Now Playing card builder (src/music/nowplaying-view.js).
function nowPlaying(t, extra, elapsed = 0) {
  const { buildNowPlayingEmbed } = require('./music/nowplaying-view');
  const e = buildNowPlayingEmbed({ track: t, elapsed });
  if (extra) e.setFooter({ text: extra });
  return e;
}

function nowPlayingControls(loop = 'off', paused = false, disabled = false) {
  return require('./music/nowplaying-view').buildNowPlayingRows({ loop, paused, disabled, canPrevious: true });
}

function queued(t, position) {
  const e = new EmbedBuilder()
    .setColor(OK)
    .setAuthor({ name: `Added to queue - position ${position}` })
    .setTitle(t.title)
    .setURL(t.url)
    .addFields(trackFields(t));
  if (t.thumbnail) e.setThumbnail(t.thumbnail);
  return e;
}

function playlistQueued(count, total, first, note) {
  const e = new EmbedBuilder()
    .setColor(OK)
    .setAuthor({ name: 'Playlist added' })
    .setTitle(`${count} tracks queued`)
    .setDescription(`Starting with **${first.title}**\nTotal length: ${fmt(total)}`);
  if (first.thumbnail) e.setThumbnail(first.thumbnail);
  if (note) e.setFooter({ text: note });
  return e;
}

const info = (text) => new EmbedBuilder().setColor(COLOR).setDescription(text);
const error = (text) => new EmbedBuilder().setColor(ERR).setDescription(text);

module.exports = { nowPlaying, nowPlayingControls, queued, playlistQueued, info, error, fmt };

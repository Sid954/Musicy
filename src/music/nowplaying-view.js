// The Now Playing card: ONE pure builder used by the announce message, /nowplaying, replies after /play
// and the live progress updater. Input is a plain snapshot (see GuildQueue.getNowPlayingSnapshot).
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { fmt, formatClock } = require('./format');
const { progressBar } = require('./progress');
const { displayTitle } = require('./title');
const { clip } = require('./pager');
const { formatTotal } = require('./collection');

const STATES = {
  playing: { label: '▶ Now playing', color: 0x5865f2 },
  paused: { label: '⏸ Paused', color: 0xfee75c },
  live: { label: '🔴 Live', color: 0xed4245 },
  autoplay: { label: '📻 Autoplay', color: 0x1abc9c },
};
const BAR_WIDTH = 14;

const isLive = (track) => Boolean(track?.isLive || !track?.duration);

function cardState({ track, paused = false }) {
  if (paused) return 'paused';
  if (isLive(track)) return 'live';
  if (track?.autoplay) return 'autoplay';
  return 'playing';
}

// Layout (same look as the original card, plus queue context):
//   ▶ Now playing / title (linked) / thumbnail
//   ▬▬🔘▬▬▬▬▬▬▬▬▬▬▬ 1:12 / 3:34
//   Duration | Channel | Requested by
//   Up next: title · 4:55  +  "182 more · 11h 44m left"
//   Settings: loop / volume / filters / ... (only the active ones)
function buildNowPlayingEmbed(snapshot) {
  const { track, elapsed = 0, badges = [], next = null, queuedCount = 0, remainingSeconds = 0, footer } = snapshot;
  const state = STATES[cardState(snapshot)];
  const live = isLive(track);

  const fields = [
    { name: 'Duration', value: live ? 'Live' : fmt(track.duration), inline: true },
    { name: 'Channel', value: clip(track.author || 'Unknown', 100), inline: true },
  ];
  if (track.requestedBy) fields.push({ name: 'Requested by', value: clip(track.requestedBy, 100), inline: true });
  if (next) {
    const lines = [`${clip(displayTitle(next.title), 80)} · ${fmt(next.duration)}`];
    const rest = [queuedCount > 1 ? `${queuedCount - 1} more` : null, remainingSeconds > 0 ? `${formatTotal(remainingSeconds)} left` : null].filter(Boolean);
    if (rest.length) lines.push(rest.join(' · '));
    fields.push({ name: 'Up next', value: lines.join('\n'), inline: false });
  }
  if (badges.length) fields.push({ name: 'Settings', value: clip(badges.join('  ·  '), 1024), inline: false });

  const embed = new EmbedBuilder()
    .setColor(state.color)
    .setAuthor({ name: state.label })
    .setTitle(clip(displayTitle(track.title), 256))
    .setDescription(live ? '🔴 **LIVE**' : `${progressBar(elapsed, track.duration, BAR_WIDTH)} ${formatClock(elapsed)} / ${formatClock(track.duration)}`)
    .addFields(fields);
  if (/^https?:\/\//i.test(String(track.url || ''))) embed.setURL(track.url);
  if (track.thumbnail) embed.setThumbnail(track.thumbnail);
  if (footer) embed.setFooter({ text: clip(footer, 2048) });
  return embed;
}

function buildNowPlayingRows({ paused = false, loop = 'off', canPrevious = false, disabled = false } = {}) {
  const button = (id, { label, emoji, style = ButtonStyle.Secondary, off = false }) => {
    const b = new ButtonBuilder().setCustomId(`np:${id}`).setStyle(style).setDisabled(disabled || off);
    if (emoji) b.setEmoji(emoji);
    if (label) b.setLabel(label);
    return b;
  };
  return [
    new ActionRowBuilder().addComponents(
      button('prev', { emoji: '⏮', label: 'Prev', off: !canPrevious }),
      button('pause', { emoji: paused ? '▶️' : '⏸️', label: paused ? 'Resume' : 'Pause', style: paused ? ButtonStyle.Success : ButtonStyle.Primary }),
      button('skip', { emoji: '⏭', label: 'Skip' }),
      button('stop', { emoji: '⏹️', label: 'Stop', style: ButtonStyle.Danger }),
      button('loop', { emoji: loop === 'track' ? '🔂' : '🔁', label: `Loop: ${loop}`, style: loop === 'off' ? ButtonStyle.Secondary : ButtonStyle.Success }),
    ),
    new ActionRowBuilder().addComponents(
      button('shuffle', { emoji: '🔀', label: 'Shuffle' }),
      button('queue', { emoji: '📜', label: 'Queue' }),
      button('favorite', { emoji: '❤️', label: 'Favorite' }),
      button('lyrics', { emoji: '🎤', label: 'Lyrics' }),
    ),
    new ActionRowBuilder().addComponents(
      button('voldown', { emoji: '🔉', label: '-10%' }),
      button('volup', { emoji: '🔊', label: '+10%' }),
    ),
  ];
}

function buildNowPlayingCard(snapshot, { withControls = true, disabled = false } = {}) {
  return {
    embed: buildNowPlayingEmbed(snapshot),
    rows: withControls ? buildNowPlayingRows({ paused: snapshot.paused, loop: snapshot.loop, canPrevious: snapshot.canPrevious, disabled }) : [],
  };
}

// Compact replacement shown after a track ends ("edit" cleanup mode).
function buildFinishedEmbed(track) {
  return new EmbedBuilder().setColor(0x4f545c).setDescription(`⏹ Finished: **${clip(displayTitle(track?.title), 200)}**`);
}

module.exports = { STATES, BAR_WIDTH, cardState, buildNowPlayingEmbed, buildNowPlayingRows, buildNowPlayingCard, buildFinishedEmbed };

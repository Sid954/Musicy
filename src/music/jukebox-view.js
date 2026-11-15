// The persistent "player" message of the request channel: idle card or the live Now Playing card + request buttons.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { buildNowPlayingEmbed } = require('./nowplaying-view');

function buildJukeboxEmbed(snapshot) {
  if (!snapshot?.track) {
    return new EmbedBuilder()
      .setColor(0x4f545c)
      .setTitle('🎶 Music player')
      .setDescription('Nothing is playing right now.\nPress **Add song** to request something — a search or a YouTube link.')
      .setFooter({ text: 'Join a voice channel first.' });
  }
  const embed = buildNowPlayingEmbed(snapshot);
  const queued = snapshot.queuedCount || 0;
  embed.setFooter({ text: queued ? `${queued} more in the queue` : 'Queue is empty — add a song!' });
  return embed;
}

function buildJukeboxRows({ active = false, paused = false, disabled = false } = {}) {
  const button = (id, { label, emoji, style = ButtonStyle.Secondary, off = false }) => {
    const b = new ButtonBuilder().setCustomId(`jb:${id}`).setStyle(style).setDisabled(disabled || off);
    if (label) b.setLabel(label);
    if (emoji) b.setEmoji(emoji);
    return b;
  };
  return [new ActionRowBuilder().addComponents(
    button('add', { label: 'Add song', emoji: '➕', style: ButtonStyle.Success }),
    button('pause', { emoji: paused ? '▶️' : '⏸️', style: paused ? ButtonStyle.Success : ButtonStyle.Primary, off: !active }),
    button('skip', { emoji: '⏭', off: !active }),
    button('stop', { emoji: '⏹️', style: ButtonStyle.Danger, off: !active }),
    button('queue', { emoji: '📜', label: 'Queue' }),
  )];
}

function buildJukeboxCard(snapshot, options = {}) {
  const active = Boolean(snapshot?.track);
  return { embed: buildJukeboxEmbed(snapshot), rows: buildJukeboxRows({ active, paused: Boolean(snapshot?.paused), ...options }) };
}

module.exports = { buildJukeboxEmbed, buildJukeboxRows, buildJukeboxCard };

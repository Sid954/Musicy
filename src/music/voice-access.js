// Friendly explanations for the usual reasons a bot "plays" but nobody hears it.
const { clip } = require('./pager');

const PERMISSIONS = [['ViewChannel', 'View Channel'], ['Connect', 'Connect'], ['Speak', 'Speak']];

// Returns null when the bot can join and talk in `channel`, otherwise a message to show the user.
// Channels without permission data (tests, partial objects) are assumed fine.
function describeVoiceAccess(channel) {
  if (!channel) return 'I could not find that voice channel.';
  if (typeof channel.permissionsFor !== 'function') return null;
  const me = channel.guild?.members?.me;
  const permissions = channel.permissionsFor(me);
  if (!permissions) return null;
  const name = clip(channel.name ? `#${channel.name}` : 'that voice channel', 60);

  const missing = PERMISSIONS.filter(([flag]) => !permissions.has(flag)).map(([, label]) => label);
  if (missing.length) {
    return `I can't use **${name}**: I'm missing the **${missing.join('**, **')}** permission${missing.length === 1 ? '' : 's'}. Ask a server admin to allow ${missing.length === 1 ? 'it' : 'them'} for my role in that channel.`;
  }
  const full = channel.userLimit > 0 && (channel.members?.size ?? 0) >= channel.userLimit;
  if (full && !permissions.has('ManageChannels') && me?.voice?.channelId !== channel.id) {
    return `**${name}** is full (${channel.userLimit} people), so I can't join. Give me the Manage Channels permission or raise the limit.`;
  }
  return null;
}

const MUTED_MESSAGE = '🔇 I\'ve been **server-muted**, so nobody can hear me. Right-click me in the voice channel and untick "Server Mute".';

module.exports = { describeVoiceAccess, MUTED_MESSAGE };

// Handler for the Now Playing card buttons (customId prefix "np:"). Kept out of index.js so it can be tested.
const music = require('./music/player');
const store = require('./store');
const embeds = require('./embeds');
const voting = require('./music/voting');
const playlists = require('./music/playlist-store');
const { canUse } = require('./music/permissions');
const { showQueue } = require('./music/queue-view');

// Buttons whose slash-command equivalent is DJ-restricted use the same permission names.
const NP_PERMISSION = { prev: 'previous', shuffle: 'shuffle', voldown: 'volume', volup: 'volume', stop: 'stop' };

// opts.action overrides the customId (used by the request-channel player); opts.skipChannelCheck lets it work outside the commands channel.
async function handleNowPlayingButton(i, opts = {}) {
  const q = music.getQueue(i.guildId);
  if (!q || !q.current) {
    await i.reply({ embeds: [embeds.error('Nothing is playing.')], ephemeral: true });
    return;
  }
  const botChannelId = i.guild.members.me?.voice?.channelId;
  if (!i.member.voice?.channelId || i.member.voice.channelId !== botChannelId) {
    await i.reply({ embeds: [embeds.error('Join my voice channel first.')], ephemeral: true });
    return;
  }

  const action = opts.action ?? i.customId.slice('np:'.length);
  const settings = store.get(i.guildId);
  if (!opts.skipChannelCheck && settings.textChannel && i.channelId !== settings.textChannel) {
    await i.reply({ embeds: [embeds.error(`Use music controls in <#${settings.textChannel}>.`)], ephemeral: true });
    return;
  }
  if (NP_PERMISSION[action] && !canUse(i.member, NP_PERMISSION[action], settings, i.channelId)) {
    await i.reply({ embeds: [embeds.error('You need the configured DJ role or Manage Server permission to use this control.')], ephemeral: true });
    return;
  }
  const say = (content) => i.reply({ content, ephemeral: true });

  if (action === 'favorite') {
    try {
      if (!playlists.get(i.user.id, 'favorites')) playlists.create(i.user.id, 'favorites');
      playlists.add(i.user.id, 'favorites', [q.current]);
      await say(`Saved **${q.current.title}** to your favorites.`);
    } catch (error) {
      await i.reply({ embeds: [embeds.error(error.message)], ephemeral: true });
    }
    return;
  }
  if (action === 'queue') {
    await showQueue(i, { ephemeral: true });
    return;
  }
  if (action === 'lyrics') {
    await require('./commands/_lyrics').sendLyrics(i, q.current);
    return;
  }
  if (action === 'pause') {
    const paused = q.player.state.status === 'paused';
    if (paused) q.player.unpause();
    else q.player.pause();
    await q.refreshAnnouncement();
    await say(paused ? 'Resumed playback.' : 'Paused playback.');
    return;
  }
  if (action === 'skip') {
    const humans = i.member.voice.channel.members.filter((member) => !member.user.bot).size;
    const result = voting.voteResult({ humanCount: humans, votes: q.skipVotes, userId: i.user.id,
      requesterId: q.current.requestedById, permissions: i.member.permissions, djRoleId: settings.djRole,
      roleIds: i.member.roles?.cache?.keys ? [...i.member.roles.cache.keys()] : [] });
    if (!result.passed) {
      await say(result.duplicate ? `You already voted (${result.votes}/${result.required}).` : `Skip vote: ${result.votes}/${result.required}.`);
      return;
    }
    q.skip();
    await say(result.required ? `Skip vote passed (${result.votes}/${result.required}).` : 'Skipped the current track.');
    return;
  }
  if (action === 'prev') {
    const previous = q.previous();
    await say(previous ? `Going back to **${previous.title}**.` : 'There is no previous track.');
    return;
  }
  if (action === 'stop') {
    q.stop();
    await say('Stopped playback and cleared the queue.');
    return;
  }
  if (action === 'loop') {
    const modes = ['off', 'track', 'queue'];
    q.loop = modes[(modes.indexOf(q.loop) + 1) % modes.length];
    await q.refreshAnnouncement();
    await say(`Loop mode: ${q.loop}.`);
    return;
  }
  if (action === 'shuffle') {
    q.shuffle();
    await q.refreshAnnouncement();
    await say(q.tracks.length ? `Shuffled ${q.tracks.length} queued tracks.` : 'Nothing queued to shuffle.');
    return;
  }
  if (action === 'voldown' || action === 'volup') {
    const level = Math.max(1, Math.min(200, Math.round(q.opts.volume * 100) + (action === 'volup' ? 10 : -10)));
    q.applyVolume(level);
    await say(`Volume: **${level}%** (playback briefly restarts).`);
    return;
  }
  await say('This control is not available.');
}

module.exports = { handleNowPlayingButton, NP_PERMISSION };

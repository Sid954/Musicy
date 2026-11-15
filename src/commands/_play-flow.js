// The one "play this text/link" flow shared by /play and the right-click "Play this" command:
// voice checks -> resolve -> playlist prompt OR queue + live Now Playing card.
const music = require('../music/player');
const embeds = require('../embeds');
const { promptCollection } = require('./_collection-prompt');
const { replyWithCard } = require('./_card');

// `i` is a fresh (not yet replied) command interaction. Always answers the user.
async function playQuery(i, query) {
  const vc = i.member.voice.channel;
  if (!vc) return i.reply({ embeds: [embeds.error('Join a voice channel first.')], ephemeral: true });
  const botChannelId = i.guild.members.me?.voice?.channelId;
  if (botChannelId && botChannelId !== vc.id) {
    const channel = i.guild.channels.cache.get(botChannelId);
    return i.reply({ embeds: [embeds.error(`I’m already in ${channel || 'another voice channel'}.`)], ephemeral: true });
  }
  await i.deferReply();
  try {
    const tracks = await music.resolve(query);
    // A playlist/album/mix: ask what to do (play all, shuffle, first only, play next, save) instead of queueing blindly.
    if (tracks.length > 1) return await promptCollection(i, tracks);
    tracks.forEach((t) => { t.requestedBy = i.member.displayName; t.requestedById = i.user.id; });
    const q = music.getOrCreate(i.guildId, vc, i.channel);
    const waiting = q.tracks.length + (q.current ? 1 : 0); // position of the first new track
    const startsNow = q.enqueue(tracks);

    if (startsNow) {
      // First song: the reply IS the live Now Playing card (controls + progress), not a "queued" message.
      await replyWithCard(i, q, tracks[0]);
    } else {
      await i.editReply({ embeds: [embeds.queued(tracks[0], waiting)] });
    }
  } catch (e) {
    await i.editReply({ embeds: [embeds.error(`Could not play that: ${e.message}`)] });
  }
}

module.exports = { playQuery };

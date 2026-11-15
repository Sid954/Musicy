// Buttons of the request-channel player (customId prefix "jb:"). The modal asks what to play; the rest reuse the np: controls.
const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const music = require('./music/player');
const embeds = require('./embeds');
const log = require('./log');
const { createCooldown } = require('./music/rate-limit');
const { handleNowPlayingButton } = require('./np-controls');

const REUSED = new Set(['pause', 'skip', 'stop', 'queue']);
const MAX_REQUEST_TRACKS = 50;
const cooldown = createCooldown({ durationMs: 3000 });

async function promptAddSong(i) {
  const userChannel = i.member.voice?.channel;
  if (!userChannel) return i.reply({ embeds: [embeds.error('Join a voice channel first, then press Add song.')], ephemeral: true });
  const botChannelId = i.guild.members.me?.voice?.channelId;
  if (botChannelId && botChannelId !== userChannel.id) {
    return i.reply({ embeds: [embeds.error(`I’m already in <#${botChannelId}>. Join it first.`)], ephemeral: true });
  }
  const wait = cooldown.check(`${i.guildId}:${i.user.id}:jb`);
  if (!wait.allowed) return i.reply({ embeds: [embeds.error(`Please wait ${(wait.retryAfterMs / 1000).toFixed(1)}s before adding another song.`)], ephemeral: true });

  const modal = new ModalBuilder().setCustomId('jb:modal').setTitle('Add a song').addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('query').setLabel('Song name or YouTube link')
        .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(200).setPlaceholder('e.g. adele hello'),
    ),
  );
  await i.showModal(modal);
  const submitted = await i.awaitModalSubmit({ time: 120_000, filter: (m) => m.customId === 'jb:modal' && m.user.id === i.user.id }).catch(() => null);
  if (!submitted) return;

  await submitted.deferReply({ ephemeral: true });
  try {
    const query = submitted.fields.getTextInputValue('query').trim();
    if (!query) throw new Error('Type a song name or paste a link.');
    const tracks = (await music.resolve(query)).slice(0, MAX_REQUEST_TRACKS);
    tracks.forEach((track) => { track.requestedBy = submitted.member.displayName; track.requestedById = submitted.user.id; });
    const queue = music.getOrCreate(submitted.guildId, userChannel, submitted.channel);
    const position = queue.tracks.length + (queue.current ? 1 : 0);
    const startsNow = queue.enqueue(tracks);
    const text = tracks.length > 1
      ? `Added **${tracks.length} tracks** to the queue.`
      : startsNow ? `▶ Now playing **${tracks[0].title}**.` : `Queued **${tracks[0].title}** at position ${position}.`;
    await submitted.editReply({ embeds: [embeds.info(text)] });
  } catch (error) {
    log.warn('Request-channel add failed:', error.message);
    await submitted.editReply({ embeds: [embeds.error(`Could not add that: ${error.message}`)] }).catch(() => {});
  }
}

async function handleJukeboxButton(i) {
  const action = i.customId.slice('jb:'.length);
  try {
    if (action === 'add') return await promptAddSong(i);
    if (REUSED.has(action)) return await handleNowPlayingButton(i, { action, skipChannelCheck: true });
    return await i.reply({ content: 'This control is not available.', ephemeral: true });
  } catch (error) {
    log.error('Player button failed:', error);
    if (!i.deferred && !i.replied) await i.reply({ content: 'Something went wrong.', ephemeral: true }).catch(() => {});
  }
}

module.exports = { handleJukeboxButton, promptAddSong, MAX_REQUEST_TRACKS };

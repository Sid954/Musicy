const { SlashCommandBuilder } = require('discord.js');
const music = require('../music/player');
const embeds = require('../embeds');
const lyrics = require('../music/lyrics');
const { sendLyrics } = require('./_lyrics');
const { parseLrc, currentLineIndex, buildLiveLyricsEmbed } = require('../music/lrc');
const { startLiveLyrics } = require('../music/live-lyrics');

// Synced lyrics that follow the song: one public message per server, edited every ~5s.
async function startLive(i, q) {
  if (!q?.current) return i.reply({ embeds: [embeds.error('Nothing is playing, so there is nothing to follow.')], ephemeral: true });
  const track = q.current;
  await i.deferReply();
  const result = await lyrics.lookupLyrics({ artist: track.author || '', title: track.title, duration: track.duration || 0 });
  const lines = parseLrc(result?.syncedLyrics);
  if (!lines.length) {
    return i.editReply({ embeds: [embeds.error(`No synced lyrics found for **${lyrics.cleanTitle(track.title)}**. Try \`/lyrics\` without \`live\` for plain lyrics.`)] });
  }
  const title = lyrics.cleanTitle(track.title) || track.title;
  await i.editReply({ embeds: [buildLiveLyricsEmbed({ title, lines, index: currentLineIndex(lines, q.getElapsedSeconds()) })] });
  const message = await i.fetchReply();
  startLiveLyrics({ guildId: i.guildId, getQueue: () => music.getQueue(i.guildId), track, lines, message, title });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lyrics')
    .setDescription('Find lyrics for the current track or a title')
    .addStringOption((o) => o.setName('title').setDescription('Track title (defaults to what is playing)').setRequired(false))
    .addBooleanOption((o) => o.setName('live').setDescription('Follow the song with synced lyrics that update as it plays')),
  async execute(i) {
    const q = music.getQueue(i.guildId);
    if (i.options.getBoolean('live')) return startLive(i, q);
    const override = i.options.getString('title');
    if (!override && !q?.current) return i.reply({ embeds: [embeds.error('Nothing is playing. Provide a title to search for lyrics.')], ephemeral: true });
    return sendLyrics(i, override ? { title: override, author: '', duration: 0 } : q.current);
  },
};

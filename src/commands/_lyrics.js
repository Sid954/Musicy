// Shared by /lyrics and the Now Playing "Lyrics" button.
const lyrics = require('../music/lyrics');
const embeds = require('../embeds');
const { showPaginatedList } = require('../music/list-view');

// Replies ephemerally with paginated plain lyrics for `track` ({ title, author?, duration? }).
async function sendLyrics(i, track) {
  await i.deferReply({ ephemeral: true });
  const result = await lyrics.lookupLyrics({ artist: track.author || track.artist || '', title: track.title, duration: track.duration || 0 });
  if (!result) return i.editReply({ embeds: [embeds.error(`No lyrics found for **${lyrics.cleanTitle(track.title)}**.`)] });
  const pages = lyrics.splitLyrics(result.plainLyrics || '');
  const content = pages.length ? pages : ['Plain lyrics are unavailable for this track.'];
  return showPaginatedList(i, {
    title: `Lyrics: ${track.title}${result.syncedLyrics ? ' · synced lyrics available' : ''}`,
    items: content,
    prefix: 'lyrics',
    perPage: 1,
    numbered: false,
    emptyText: 'Plain lyrics are unavailable for this track.',
    editInitial: true,
  });
}

module.exports = { sendLyrics };

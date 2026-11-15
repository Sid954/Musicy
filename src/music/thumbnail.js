// Cover image for a track. Playlist listings and saved playlists often have no thumbnail, which made the Now
// Playing card render narrow and without a picture; every YouTube video has a predictable one.
function youtubeVideoId(url) {
  try {
    const u = new URL(String(url || ''));
    const host = u.hostname.replace(/^www\./, '').replace(/^m\./, '');
    if (host === 'youtu.be') return /^[\w-]{11}$/.test(u.pathname.slice(1, 12)) ? u.pathname.slice(1, 12) : null;
    if (host === 'youtube.com' || host === 'music.youtube.com') {
      const id = u.searchParams.get('v');
      return id && /^[\w-]{11}$/.test(id) ? id : null;
    }
  } catch { /* not a URL */ }
  return null;
}

function trackThumbnail(track) {
  if (track?.thumbnail) return track.thumbnail;
  const id = youtubeVideoId(track?.url);
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
}

module.exports = { youtubeVideoId, trackThumbnail };

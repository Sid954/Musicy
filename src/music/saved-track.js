async function resolveSavedTrack(item, { resolve, resolveSpotifyQuery }) {
  const tracks = item?.spotifyQuery
    ? await resolveSpotifyQuery(item.spotifyQuery)
    : await resolve(item.url);
  return tracks || [];
}

function savedTrackUrl(track) {
  return track?.spotifyQuery ? `ytsearch1:${track.spotifyQuery}` : track?.url || '';
}

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be']);

function isYoutubeWatchUrl(value) {
  try {
    return YOUTUBE_HOSTS.has(new URL(value).hostname.toLowerCase());
  } catch {
    return false;
  }
}

// Saved items already hold title/url/duration, so YouTube and Spotify entries become playable tracks with
// NO network call (playback resolves the audio when the track starts). Anything else is resolved normally.
// Without this, loading a 50-track playlist cost 50 sequential yt-dlp launches (minutes).
async function loadSavedTracks(items, { resolve }) {
  const tracks = [];
  for (const item of items) {
    const base = { title: item.title || 'Unknown', duration: item.duration || 0, author: item.author || '' };
    if (item.spotifyQuery) {
      tracks.push({ ...base, url: item.url, spotifyQuery: item.spotifyQuery, source: 'spotify' });
    } else if (isYoutubeWatchUrl(item.url)) {
      tracks.push({ ...base, url: item.url, source: 'youtube' });
    } else {
      tracks.push(...(await resolve(item.url) || []));
    }
  }
  return tracks;
}

module.exports = { resolveSavedTrack, savedTrackUrl, loadSavedTracks, isYoutubeWatchUrl };

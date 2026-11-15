// Spotify links: Musicy reads the PUBLIC embed page of a track / album / playlist (no API keys, no login) to get
// song names and lengths, then plays the matching audio from YouTube. No audio ever comes from Spotify.
//
// Why not the official Web API? Since Spotify's 2026 Development Mode rules an app needs a Premium owner and can
// only read playlists its own user owns, so client-credentials keys cannot read public playlists. The embed page
// lists up to 100 tracks of any public playlist/album with title, artist and duration.
const youtube = require('./youtube');

const MAX_TRACKS = 100; // what the embed page lists per playlist/album
const SPOTIFY_HOST = 'open.spotify.com';
const requestTimeoutSignal = () => (typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(10_000) : undefined);

// open.spotify.com/track/ID, /album/ID, /playlist/ID (also with a language prefix like /intl-de/ and ?si= tracking).
function parseSpotifyUrl(value) {
  try {
    const url = new URL(value);
    if (url.hostname.toLowerCase() !== SPOTIFY_HOST || url.protocol !== 'https:') return null;
    const match = url.pathname.match(/^\/(?:intl-[a-z-]+\/)?(?:embed\/)?(track|album|playlist)\/([A-Za-z0-9]+)\/?$/);
    return match ? { type: match[1], id: match[2], url: `https://${SPOTIFY_HOST}/${match[1]}/${match[2]}` } : null;
  } catch {
    return null;
  }
}

const isSpotifyUrl = (query) => Boolean(parseSpotifyUrl(query));

// Any open.spotify.com link belongs to this source, so an unsupported one (artist, podcast) gets a clear message
// instead of falling through to a generic downloader.
function isSpotifyHost(query) {
  try {
    const url = new URL(query);
    return url.protocol === 'https:' && url.hostname.toLowerCase() === SPOTIFY_HOST;
  } catch {
    return false;
  }
}

const seconds = (ms) => (Number(ms) > 0 ? Math.round(Number(ms) / 1000) : 0);

function nextDataEntity(html) {
  const script = String(html).match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (!script) return null;
  try { return JSON.parse(script)?.props?.pageProps?.state?.data?.entity || null; } catch { return null; }
}

// Returns { type, title, tracks: [{ title, artist, duration (s), uri }] } or null.
function parseSpotifyEmbed(html) {
  const entity = nextDataEntity(html);
  if (entity) {
    if (entity.type === 'track') {
      const artist = (entity.artists || []).map((a) => a?.name).filter(Boolean).join(', ') || String(entity.subtitle || '');
      const title = String(entity.name || entity.title || '');
      return title && artist ? { type: 'track', title, tracks: [{ title, artist, duration: seconds(entity.duration), uri: entity.uri }] } : null;
    }
    if (entity.type === 'album' || entity.type === 'playlist') {
      const tracks = (Array.isArray(entity.trackList) ? entity.trackList : [])
        .filter((item) => item && item.title && item.subtitle && item.isPlayable !== false)
        .slice(0, MAX_TRACKS)
        .map((item) => ({ title: String(item.title), artist: String(item.subtitle), duration: seconds(item.duration), uri: item.uri }));
      return tracks.length ? { type: entity.type, title: String(entity.name || entity.title || ''), tracks } : null;
    }
    return null;
  }
  // Last resort for a track page without the data block: "<Song> by <Artist> | Spotify" in the title.
  const title = String(html).match(/<title[^>]*>(.*?)<\/title>/i)?.[1]?.replace(/\s*\|\s*Spotify\s*$/i, '').replace(/&amp;/g, '&').trim();
  const match = title?.match(/^(.+?)\s+by\s+(.+)$/i);
  return match ? { type: 'track', title: match[1], tracks: [{ title: match[1], artist: match[2], duration: 0 }] } : null;
}

async function fetchMetadata(url, fetchImpl = globalThis.fetch) {
  if (!fetchImpl) throw new Error('Spotify lookup is unavailable on this Node version.');
  const parsed = parseSpotifyUrl(url);
  if (!parsed) throw new Error('Musicy can play Spotify **track, album and playlist** links (not artists or podcasts).');
  let response;
  try {
    response = await fetchImpl(`https://${SPOTIFY_HOST}/embed/${parsed.type}/${parsed.id}`, { headers: { 'user-agent': 'Mozilla/5.0' }, signal: requestTimeoutSignal() });
  } catch {
    throw new Error('Spotify could not be reached. Please try again in a moment.');
  }
  if (response.status === 404) throw new Error('That Spotify link does not exist, or the playlist is private.');
  if (!response.ok) throw new Error('Spotify could not be read right now. Please try again later.');
  const parsedPage = parseSpotifyEmbed(await response.text());
  if (!parsedPage) throw new Error('No playable tracks were found in that Spotify link (it may be private, empty or not available in your region).');
  return parsedPage;
}

// A match is "right" when its length is close to the Spotify length (live cuts, extended mixes and 10-hour
// loops are not).
const lengthTolerance = (spotifySeconds) => Math.max(12, Math.round(spotifySeconds * 0.08));

// Finds the YouTube video for one Spotify song. Fast path: ONE lookup. If that result's length is clearly off,
// the next results are compared and the closest length wins. `deps` is injectable for tests.
async function matchOnYoutube(item, deps = {}) {
  const resolveOne = deps.resolve || ((query) => youtube.resolve(query));
  const searchMany = deps.search || ((query, count) => youtube.resolveMany(query, count));
  const query = `${item.artist} - ${item.title}`;
  const [best] = await resolveOne(query);
  if (!best) throw new Error(`No matching YouTube audio was found for ${query}.`);
  if (!item.duration || !best.duration) return best;

  const gap = Math.abs(best.duration - item.duration);
  if (gap <= lengthTolerance(item.duration)) return best;

  let candidates = [];
  try { candidates = await searchMany(query, 6); } catch { /* keep the first result */ }
  const closest = candidates
    .filter((candidate) => candidate.duration > 0 && candidate.url)
    .sort((a, b) => Math.abs(a.duration - item.duration) - Math.abs(b.duration - item.duration))[0];
  if (!closest || closest.url === best.url || Math.abs(closest.duration - item.duration) >= gap) return best;
  const [better] = await resolveOne(closest.url); // full details incl. the direct audio URL
  return better || best;
}

// Spotify names are cleaner than YouTube titles ("Artist - Song" vs "... (Official Video) (4K Remaster)").
function applySpotifyInfo(track, item, collectionTitle) {
  track.title = `${item.artist} - ${item.title}`;
  track.author = item.artist;
  track.source = 'youtube';
  if (collectionTitle) track.playlistTitle = collectionTitle;
  return track;
}

async function resolve(query) {
  const { title: collectionTitle, tracks: items } = await fetchMetadata(query);
  const [first, ...rest] = items;
  const tracks = [applySpotifyInfo(await matchOnYoutube(first), first, items.length > 1 ? collectionTitle : '')];
  // The rest are resolved lazily, right before they play (or while the previous song plays).
  for (const item of rest) {
    tracks.push({
      title: `${item.artist} - ${item.title}`,
      author: item.artist,
      duration: item.duration || 0,
      url: query,
      spotifyQuery: `${item.artist} - ${item.title}`,
      spotifyArtist: item.artist,
      spotifyTitle: item.title,
      spotifyDuration: item.duration || 0,
      playlistTitle: collectionTitle,
      source: 'spotify',
    });
  }
  return tracks;
}

async function resolveMany(query, count = 5) {
  return (await resolve(query)).slice(0, Math.min(5, Math.max(1, count)));
}

async function resolveLazy(track, deps) {
  if (!track.spotifyQuery) return track;
  const item = track.spotifyArtist
    ? { artist: track.spotifyArtist, title: track.spotifyTitle, duration: track.spotifyDuration }
    : { artist: '', title: track.spotifyQuery, duration: 0 }; // restored from a saved queue/playlist: search by the saved text
  const matched = item.artist ? await matchOnYoutube(item, deps) : (await (deps?.resolve || ((q) => youtube.resolve(q)))(item.title))[0];
  if (!matched) throw new Error(`No matching YouTube audio was found for ${track.spotifyQuery}.`);
  const title = track.title;
  const author = track.author;
  const playlistTitle = track.playlistTitle;
  Object.assign(track, matched, { source: 'youtube', title, author, playlistTitle });
  for (const key of ['spotifyQuery', 'spotifyArtist', 'spotifyTitle', 'spotifyDuration']) delete track[key];
  return track;
}

async function stream(track, options) {
  const resolved = await resolveLazy(track);
  return youtube.stream(resolved, options);
}

async function prefetch(track, options) {
  const resolved = await resolveLazy(track);
  return youtube.prefetch(resolved, options);
}

module.exports = {
  name: 'spotify', canHandle: isSpotifyHost, resolve, resolveMany, resolveLazy, stream, prefetch,
  parseSpotifyUrl, parseSpotifyEmbed, fetchMetadata, isSpotifyUrl, isSpotifyHost, matchOnYoutube, lengthTolerance, MAX_TRACKS,
};

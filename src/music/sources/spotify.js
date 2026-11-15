const youtube = require('./youtube');
const MAX_TRACKS = 100;
const SPOTIFY_HOST = 'open.spotify.com';
const requestTimeoutSignal = () => (typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(10_000) : undefined);

function parseSpotifyUrl(value) {
  try {
    const url = new URL(value);
    if (url.hostname.toLowerCase() !== SPOTIFY_HOST || url.protocol !== 'https:') return null;
    const match = url.pathname.match(/^\/(track|album|playlist)\/([A-Za-z0-9]+)\/?$/);
    return match ? { type: match[1], id: match[2], url: `https://${SPOTIFY_HOST}/${match[1]}/${match[2]}` } : null;
  } catch {
    return null;
  }
}

function collectTrackMetadata(value, out = [], seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return out;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectTrackMetadata(item, out, seen);
    return out;
  }

  const type = String(value.type || value.__typename || '').toLowerCase();
  const artists = Array.isArray(value.artists) ? value.artists.map((artist) => artist?.name).filter(Boolean) : [];
  const name = typeof value.name === 'string' ? value.name : '';
  if (name && artists.length && (type.includes('track') || value.duration_ms || value.track_number)) {
    const key = `${name.toLowerCase()}\n${artists.join(',').toLowerCase()}`;
    if (!out.some((track) => track.key === key)) out.push({
      title: name, artist: artists.join(', '), duration: Number(value.duration_ms) > 0 ? Math.round(value.duration_ms / 1000) : 0, key,
    });
  }
  for (const child of Object.values(value)) collectTrackMetadata(child, out, seen);
  return out;
}

function parseSpotifyEmbed(html) {
  const scripts = [...String(html).matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)];
  const candidates = [];
  for (const [, body] of scripts) {
    const trimmed = body.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) continue;
    try { candidates.push(JSON.parse(trimmed)); } catch {}
  }
  const tracks = [];
  const seen = new Set();
  for (const candidate of candidates) collectTrackMetadata(candidate, tracks, seen);
  if (!tracks.length) {
    const title = String(html).match(/<title[^>]*>(.*?)<\/title>/i)?.[1]
      ?.replace(/\s*\|\s*Spotify\s*$/i, '').replace(/&amp;/g, '&').trim();
    const match = title?.match(/^(.+?)\s+by\s+(.+)$/i);
    if (match) tracks.push({ title: match[1], artist: match[2], key: `${match[1].toLowerCase()}\n${match[2].toLowerCase()}` });
  }
  return tracks.slice(0, MAX_TRACKS).map(({ title, artist, duration }) => ({ title, artist, duration }));
}

function isSpotifyUrl(query) {
  return Boolean(parseSpotifyUrl(query));
}

async function fetchMetadata(url, fetchImpl = globalThis.fetch) {
  if (!fetchImpl) throw new Error('Spotify metadata lookup is unavailable.');
  const parsed = parseSpotifyUrl(url);
  if (!parsed) throw new Error('Enter a Spotify track, album, or playlist URL.');
  const response = await fetchImpl(`https://${SPOTIFY_HOST}/embed/${parsed.type}/${parsed.id}`, {
    headers: { 'user-agent': 'Mozilla/5.0' },
    signal: requestTimeoutSignal(),
  });
  if (!response.ok) throw new Error('Spotify metadata could not be loaded.');
  const tracks = parseSpotifyEmbed(await response.text());
  if (!tracks.length) throw new Error('No playable tracks were found in that Spotify link.');
  return tracks;
}

async function resolve(query) {
  const metadata = await fetchMetadata(query);
  const first = metadata[0];
  const resolved = await youtube.resolve(`${first.artist} - ${first.title}`);
  if (!resolved.length) throw new Error('No matching YouTube audio was found for that Spotify track.');
  const tracks = resolved.slice(0, 1);
  tracks[0].source = 'youtube';
  for (const item of metadata.slice(1)) {
    tracks.push({
      title: item.title,
      author: item.artist,
      duration: item.duration || 0,
      url: query,
      spotifyQuery: `${item.artist} - ${item.title}`,
      source: 'spotify',
    });
  }
  return tracks;
}

async function resolveMany(query, count = 5) {
  return (await resolve(query)).slice(0, Math.min(5, Math.max(1, count)));
}

async function resolveLazy(track) {
  if (!track.spotifyQuery) return track;
  const [resolved] = await youtube.resolve(track.spotifyQuery);
  Object.assign(track, resolved, { source: 'youtube' });
  delete track.spotifyQuery;
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
  name: 'spotify', canHandle: isSpotifyUrl, resolve, resolveMany, stream, prefetch,
  parseSpotifyUrl, parseSpotifyEmbed, collectTrackMetadata, fetchMetadata, isSpotifyUrl, MAX_TRACKS,
};

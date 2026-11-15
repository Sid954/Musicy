const CACHE_LIMIT = 200;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CATEGORIES = ['sponsor', 'selfpromo', 'intro', 'outro'];
const cache = new Map();

function youtubeVideoId(track) {
  if (!track || typeof track.url !== 'string') return null;
  try {
    const url = new URL(track.url);
    const host = url.hostname.toLowerCase();
    if (host === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0] || null;
    if (!['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host)) return null;
    if (url.pathname === '/watch') return url.searchParams.get('v');
    const match = url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/);
    return match?.[1] || null;
  } catch {
    return null;
  }
}

function normalizeSegments(payload) {
  if (!Array.isArray(payload)) return [];
  return payload.map((item) => ({
    start: Number(item?.segment?.[0]), end: Number(item?.segment?.[1]),
    category: String(item?.category || ''),
  })).filter((segment) => Number.isFinite(segment.start) && Number.isFinite(segment.end)
    && segment.start >= 0 && segment.end > segment.start && CATEGORIES.includes(segment.category))
    .sort((a, b) => a.start - b.start);
}

function nextSegment(segments, elapsed) {
  return segments.find((segment) => segment.end > elapsed) || null;
}

async function getSegments(track, fetchImpl = globalThis.fetch) {
  const videoId = youtubeVideoId(track);
  if (!videoId || !fetchImpl) return [];
  const now = Date.now();
  const cached = cache.get(videoId);
  if (cached && cached.expiresAt > now) {
    cache.delete(videoId);
    cache.set(videoId, cached);
    return cached.segments;
  }
  if (cached) cache.delete(videoId);
  try {
    const categories = encodeURIComponent(JSON.stringify(CATEGORIES));
    const response = await fetchImpl(`https://sponsor.ajay.app/api/skipSegments?videoID=${encodeURIComponent(videoId)}&categories=${categories}`, {
      signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(8000) : undefined,
    });
    if (!response.ok) return [];
    const segments = normalizeSegments(await response.json());
    cache.set(videoId, { segments, expiresAt: now + CACHE_TTL_MS });
    while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
    return segments;
  } catch {
    return [];
  }
}

function clearCache() {
  cache.clear();
}

module.exports = { getSegments, youtubeVideoId, normalizeSegments, nextSegment, clearCache, CACHE_LIMIT, CACHE_TTL_MS, CATEGORIES };

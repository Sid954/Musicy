// Small bounded LRU + TTL cache of resolved single tracks (incl. their direct audio URL).
// A hit makes replaying / picking the same suggestion nearly instant (no yt-dlp launch).
const MAX_ENTRIES = 200;
const TTL_MS = 30 * 60_000;

const normalizeQuery = (query) => String(query ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

// Callers mutate tracks (requestedBy, prefetchedAudioUrl is consumed), so the cache stores and returns copies.
function cloneTrack(track) {
  const copy = { ...track };
  delete copy.requestedBy;
  delete copy.requestedById;
  delete copy.prefetchPromise;
  return copy;
}

function createResolveCache({ max = MAX_ENTRIES, ttlMs = TTL_MS, now = Date.now, isFresh = () => true } = {}) {
  const entries = new Map();

  function get(query) {
    const key = normalizeQuery(query);
    const entry = entries.get(key);
    if (!entry) return null;
    if (now() - entry.at > ttlMs || !isFresh(entry.track)) {
      entries.delete(key);
      return null;
    }
    entries.delete(key); // refresh LRU position
    entries.set(key, entry);
    return cloneTrack(entry.track);
  }

  function set(query, track) {
    const key = normalizeQuery(query);
    if (!key || !track || !isFresh(track)) return false; // never cache something that could not be played instantly
    entries.delete(key);
    entries.set(key, { at: now(), track: cloneTrack(track) });
    while (entries.size > max) entries.delete(entries.keys().next().value);
    return true;
  }

  return { get, set, clear: () => entries.clear(), get size() { return entries.size; } };
}

module.exports = { MAX_ENTRIES, TTL_MS, normalizeQuery, cloneTrack, createResolveCache };

const MAX_ENTRIES = 200;
const TTL_MS = 5 * 60 * 1000;
const MAX_CHOICES = 25;
const cache = new Map();

function normalizeSuggestions(payload) {
  const suggestions = Array.isArray(payload) && Array.isArray(payload[1]) ? payload[1] : [];
  const unique = [];
  const seen = new Set();
  for (const entry of suggestions) {
    const value = typeof entry === 'string' ? entry : Array.isArray(entry) ? entry[0] : null;
    if (typeof value !== 'string') continue;
    const name = value.trim().slice(0, 100);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    unique.push(name);
    if (unique.length === MAX_CHOICES) break;
  }
  return unique;
}

function createSuggestService({
  fetchFn = global.fetch,
  now = Date.now,
  cacheMap = new Map(),
  maxEntries = MAX_ENTRIES,
  ttlMs = TTL_MS,
} = {}) {
  async function suggest(query) {
    const key = String(query || '').trim();
    if (!key) return [];
    const cached = cacheMap.get(key);
    if (cached && now() - cached.time < ttlMs) {
      cacheMap.delete(key);
      cacheMap.set(key, cached);
      return [...cached.values];
    }
    if (cached) cacheMap.delete(key);

    try {
      const url = `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(key)}`;
      const response = await fetchFn(url, { headers: { 'User-Agent': 'Musicy' } });
      if (!response.ok) return [];
      const values = normalizeSuggestions(await response.json());
      if (values.length) {
        cacheMap.set(key, { time: now(), values });
        while (cacheMap.size > maxEntries) cacheMap.delete(cacheMap.keys().next().value);
      }
      return values;
    } catch {
      return [];
    }
  }
  return { suggest, cache: cacheMap };
}

const service = createSuggestService();
module.exports = { suggest: service.suggest, createSuggestService, normalizeSuggestions, cache: service.cache, clearCache: () => service.cache.clear() };

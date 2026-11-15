const PAGE_SIZE = 3500;

function cleanTitle(value) {
  return String(value || '')
    .replace(/\s*\[[^\]]*(?:official|video|audio|lyrics?|visuali[sz]er)[^\]]*\]/gi, ' ')
    .replace(/\s*\([^)]*(?:official|video|audio|lyrics?|visuali[sz]er)[^)]*\)/gi, ' ')
    .replace(/\s*[-–—]\s*Topic\s*$/i, ' ')
    .replace(/\s+(?:ft\.?|feat\.?|featuring)\s+[^([\]-]+/i, ' ')
    .replace(/\s*\|\s*.*$/, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitLyrics(lyrics, pageSize = PAGE_SIZE) {
  const text = String(lyrics || '').trim();
  if (!text) return [];
  const pages = [];
  let remaining = text;
  while (remaining.length > pageSize) {
    let boundary = remaining.lastIndexOf('\n', pageSize);
    if (boundary < pageSize * 0.5) boundary = remaining.lastIndexOf(' ', pageSize);
    if (boundary < pageSize * 0.5) boundary = pageSize;
    pages.push(remaining.slice(0, boundary).trimEnd());
    remaining = remaining.slice(boundary).trimStart();
  }
  if (remaining) pages.push(remaining);
  return pages;
}

async function fetchJson(url, fetchFn = globalThis.fetch) {
  const response = await fetchFn(url, {
    headers: { 'User-Agent': 'Musicy/1.0 (lyrics lookup; https://github.com/Sid954/Musicy)' },
    signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(8000) : undefined,
  });
  if (!response.ok) return null;
  return response.json();
}

async function lookupLyrics({ artist = '', title, duration = 0 }, fetchFn = globalThis.fetch) {
  if (!title || !fetchFn) return null;
  const trackName = cleanTitle(title);
  const artistName = cleanTitle(artist);
  try {
    const params = new URLSearchParams({ track_name: trackName });
    if (artistName) params.set('artist_name', artistName);
    if (duration > 0) params.set('duration', String(Math.round(duration)));
    const exact = await fetchJson(`https://lrclib.net/api/get?${params}`, fetchFn);
    if (exact?.plainLyrics || exact?.syncedLyrics) return exact;
  } catch {}
  try {
    const params = new URLSearchParams({ q: [artistName, trackName].filter(Boolean).join(' ') });
    const results = await fetchJson(`https://lrclib.net/api/search?${params}`, fetchFn);
    return Array.isArray(results) ? results.find((result) => result?.plainLyrics || result?.syncedLyrics) || null : null;
  } catch {
    return null;
  }
}

module.exports = { cleanTitle, splitLyrics, lookupLyrics, PAGE_SIZE };

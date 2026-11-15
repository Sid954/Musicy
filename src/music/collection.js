// Pure helpers for multi-track results (YouTube/Spotify playlists, mixes, saved playlists).
const { shuffleTracks } = require('./queue-ops');

function summarize(tracks) {
  const totalSeconds = tracks.reduce((sum, track) => sum + (Number.isFinite(track.duration) && track.duration > 0 ? track.duration : 0), 0);
  return {
    count: tracks.length,
    totalSeconds,
    liveCount: tracks.filter((track) => track.isLive).length,
    title: tracks.find((track) => track.playlistTitle)?.playlistTitle || null,
  };
}

function formatTotal(seconds) {
  const total = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m`;
  return `${total}s`;
}

// modes: "order" (as-is), "shuffle" (random order), "first" (only the first track). Never mutates the input.
function orderTracks(tracks, mode = 'order', random = Math.random) {
  if (mode === 'first') return tracks.slice(0, 1);
  const copy = tracks.slice();
  return mode === 'shuffle' ? shuffleTracks(copy, random) : copy;
}

// Picks a free playlist name: "Name", "Name 2", "Name 3", ... within the 32-character limit.
function uniquePlaylistName(base, existing, maxLength = 32) {
  const taken = new Set(existing);
  const root = String(base || 'Saved playlist').trim().slice(0, maxLength) || 'Saved playlist';
  if (!taken.has(root)) return root;
  for (let n = 2; n < 1000; n++) {
    const suffix = ` ${n}`;
    const candidate = `${root.slice(0, maxLength - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error('Could not find a free playlist name.');
}

// Identity of a track for duplicate detection: YouTube video id, else Spotify query, else URL.
function trackKey(track) {
  const url = String(track?.url || '');
  const id = url.match(/[?&]v=([\w-]{6,})/)?.[1] || url.match(/youtu\.be\/([\w-]{6,})/)?.[1] || url.match(/\/shorts\/([\w-]{6,})/)?.[1];
  if (id) return `yt:${id}`;
  if (track?.spotifyQuery) return `sp:${String(track.spotifyQuery).toLowerCase()}`;
  return `url:${url}`;
}

function dedupeAgainst(tracks, existing = []) {
  const taken = new Set(existing.filter(Boolean).map(trackKey));
  return tracks.filter((track) => !taken.has(trackKey(track)));
}

// "10" -> 10, clamped to max. Anything that is not a positive whole number -> null.
function parseCount(text, max = 200) {
  const value = String(text ?? '').trim();
  if (!/^\d{1,4}$/.test(value)) return null;
  const n = Number(value);
  return n >= 1 ? Math.min(n, max) : null;
}

// Applies "first N", ordering, duplicate filtering, the per-track length limit and the queue-room limit.
// Returns { chosen, skipped (duplicates), tooLong (over maxDuration), trimmed (cut by `limit`) }.
function prepareSelection(tracks, {
  mode = 'order', count = 0, skipDuplicates = false, existing = [], random = Math.random, limit = Infinity, maxDuration = 0,
} = {}) {
  const base = count > 0 ? tracks.slice(0, count) : tracks;
  const ordered = orderTracks(base, mode, random);
  const unique = skipDuplicates ? dedupeAgainst(ordered, existing) : ordered;
  const playable = maxDuration > 0 ? unique.filter((track) => !(track.duration > maxDuration)) : unique;
  const room = Math.max(0, Number.isFinite(limit) ? Math.floor(limit) : playable.length);
  const chosen = playable.slice(0, room);
  return { chosen, skipped: ordered.length - unique.length, tooLong: unique.length - playable.length, trimmed: playable.length - chosen.length };
}

// Removes duplicate videos from a queue (keeping the first occurrence). `current` counts as already taken.
function dedupeQueue(tracks, current = null) {
  const taken = new Set(current ? [trackKey(current)] : []);
  const kept = [];
  let removed = 0;
  for (const track of tracks) {
    const key = trackKey(track);
    if (taken.has(key)) { removed++; continue; }
    taken.add(key);
    kept.push(track);
  }
  return { kept, removed };
}

// 1-based position of the first queued track whose title contains `text` (case-insensitive); 0 if none.
function findQueuePosition(tracks, text) {
  const needle = String(text ?? '').trim().toLowerCase();
  if (!needle) return 0;
  const index = tracks.findIndex((track) => String(track?.title || '').toLowerCase().includes(needle));
  return index + 1;
}

module.exports = { dedupeQueue, findQueuePosition, summarize, formatTotal, orderTracks, uniquePlaylistName, trackKey, dedupeAgainst, parseCount, prepareSelection };

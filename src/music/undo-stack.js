// Bounded, expiring history of queue snapshots for /undo. Snapshots are shallow copies of the track list
// (track objects are shared, so they cost almost no memory).
const DEFAULT_LIMIT = 10;
const DEFAULT_MAX_AGE_MS = 10 * 60_000;

function createUndoStack({ limit = DEFAULT_LIMIT, maxAgeMs = DEFAULT_MAX_AGE_MS, now = Date.now } = {}) {
  let entries = [];

  const fresh = () => { const at = now(); entries = entries.filter((entry) => at - entry.at <= maxAgeMs); };

  return {
    push(label, tracks) {
      fresh();
      entries.push({ label, tracks: [...tracks], at: now() });
      if (entries.length > limit) entries = entries.slice(-limit);
    },
    // The most recent still-valid snapshot, or null.
    pop() {
      fresh();
      return entries.pop() || null;
    },
    peek() {
      fresh();
      return entries.at(-1)?.label ?? null;
    },
    clear() { entries = []; },
    get size() { fresh(); return entries.length; },
  };
}

module.exports = { DEFAULT_LIMIT, DEFAULT_MAX_AGE_MS, createUndoStack };

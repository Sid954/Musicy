// Pure helpers for the sleep timer.
const MAX_SLEEP_MINUTES = 720;

function clampMinutes(minutes) {
  const n = Math.floor(Number(minutes));
  if (!Number.isFinite(n) || n < 1) throw new RangeError('Choose at least 1 minute.');
  return Math.min(n, MAX_SLEEP_MINUTES);
}

function formatRemaining(ms) {
  const totalMinutes = Math.max(1, Math.ceil(ms / 60_000));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

// `state`: { sleepAt: epoch ms | null, afterTrack: boolean }. Returns a short badge text or null.
function describeSleep({ sleepAt = null, afterTrack = false } = {}, now = Date.now()) {
  if (afterTrack) return '😴 Sleep after this track';
  if (sleepAt && sleepAt > now) return `😴 Sleep in ${formatRemaining(sleepAt - now)}`;
  return null;
}

module.exports = { MAX_SLEEP_MINUTES, clampMinutes, formatRemaining, describeSleep };

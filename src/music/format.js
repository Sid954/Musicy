// Pure time formatting shared by embeds and views.

// A DURATION: 0 / missing means a live stream.
function fmt(seconds) {
  if (!seconds) return 'Live';
  return formatClock(seconds);
}

// An elapsed POSITION: never returns "Live" (0 is a valid position and renders 0:00).
function formatClock(seconds) {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

module.exports = { fmt, formatClock };

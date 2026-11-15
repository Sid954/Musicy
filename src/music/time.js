function isSeekableTrack(track) {
  return Boolean(track && !track.isLive && Number.isFinite(track.duration) && track.duration > 0);
}

function parseSeekTime(input) {
  if (typeof input !== 'string') return null;
  const value = input.trim();
  const relative = /^[+-]/.test(value);
  const time = relative ? value.slice(1) : value;
  if (!/^\d+(?::\d{1,2}){0,2}$/.test(time)) return null;

  const parts = time.split(':').map(Number);
  if (parts.some((part) => !Number.isInteger(part)) || parts.slice(1).some((part) => part > 59)) return null;
  const seconds = parts.length === 1
    ? parts[0]
    : parts.length === 2
      ? parts[0] * 60 + parts[1]
      : parts[0] * 3600 + parts[1] * 60 + parts[2];
  return { seconds: relative && value[0] === '-' ? -seconds : seconds, relative };
}

module.exports = { parseSeekTime, isSeekableTrack };

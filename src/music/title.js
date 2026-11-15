// Display-only title cleanup (never mutate track.title itself).
const NOISE = /(official|video|audio|lyrics?|lyric video|visuali[sz]er|music video|\bhd\b|\b4k\b|\bmv\b|remaster(?:ed)?)/i;

function displayTitle(title) {
  const original = String(title || '').trim();
  if (!original) return 'Unknown';
  const cleaned = original
    .replace(/\s*[\[(][^\])]*[\])]/g, (group) => (NOISE.test(group) ? ' ' : group))
    .replace(/\s*#[\p{L}\p{N}_]+/gu, ' ')
    .replace(/\s*[-–—]\s*Topic\s*$/i, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || original;
}

module.exports = { displayTitle };

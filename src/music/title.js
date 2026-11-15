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

// Short form for cards: cuts YouTube's "| Movie | Singer | Label" tails and "- Full Video" and limits the length
// (about the average song title), breaking at a word.
function shortTitle(title, max = 50) {
  let value = displayTitle(title);
  const bar = value.search(/\s[|｜]\s/);
  if (bar >= 6) value = value.slice(0, bar);
  value = value.replace(/\s*[-–—:]\s*full\s+(video|song|audio|album)\s*$/i, '').trim() || value;
  if (value.length <= max) return value;
  const cut = value.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:&|-]+$/, '')}…`;
}

module.exports = { displayTitle, shortTitle };

function progressBar(elapsed, total, width = 12) {
  if (!Number.isFinite(total) || total <= 0) return 'LIVE';
  const safeWidth = Number.isInteger(width) ? Math.max(1, Math.min(width, 60)) : 12;
  const ratio = Math.max(0, Math.min(1, (Number.isFinite(elapsed) ? elapsed : 0) / total));
  const position = Math.round(ratio * (safeWidth - 1));
  return `${'▬'.repeat(position)}🔘${'▬'.repeat(safeWidth - position - 1)}`;
}

// Block-style bar used by the Now Playing card: ▰▰▰▱▱▱
function blockBar(elapsed, total, width = 14) {
  if (!Number.isFinite(total) || total <= 0) return '';
  const safeWidth = Number.isInteger(width) ? Math.max(1, Math.min(width, 40)) : 14;
  const ratio = Math.max(0, Math.min(1, (Number.isFinite(elapsed) ? elapsed : 0) / total));
  const filled = Math.round(ratio * safeWidth);
  return `${'▰'.repeat(filled)}${'▱'.repeat(safeWidth - filled)}`;
}

module.exports = { progressBar, blockBar };

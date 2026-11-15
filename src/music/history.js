const HISTORY_LIMIT = 25;

function addHistory(history, track, limit = HISTORY_LIMIT) {
  if (!track) return (history || []).slice(-limit);
  const copy = { ...track };
  delete copy.prefetchedAudioUrl;
  delete copy.prefetchPromise;
  return [copy, ...(history || [])].slice(0, limit);
}

function getHistoryTrack(history, position) {
  if (!Number.isInteger(position) || position < 1 || position > (history || []).length) return null;
  return history[position - 1] || null;
}

function cloneReplay(track) {
  if (!track) return null;
  const copy = { ...track };
  delete copy.prefetchedAudioUrl;
  delete copy.prefetchPromise;
  delete copy.autoplay;
  return copy;
}

module.exports = { addHistory, getHistoryTrack, cloneReplay, HISTORY_LIMIT };

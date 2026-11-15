const MAX_PERSISTED_TRACKS = 100;

function snapshotQueue(queue, now = Date.now()) {
  const clean = (track) => track && ({ title: track.title, url: track.url, duration: track.duration || 0, author: track.author || '', source: track.source || 'youtube', ...(track.spotifyQuery ? { spotifyQuery: track.spotifyQuery } : {}) });
  const current = clean(queue.current);
  const tracks = queue.tracks.slice(0, MAX_PERSISTED_TRACKS - (current ? 1 : 0)).map(clean).filter(Boolean);
  return {
    voiceChannelId: queue.voiceChannelId,
    textChannelId: queue.textChannel?.id || null,
    current,
    tracks,
    loop: ['off', 'track', 'queue'].includes(queue.loop) ? queue.loop : 'off',
    position: current ? Math.max(0, Math.floor(queue.getElapsedSeconds())) : 0,
    savedAt: now,
  };
}

function normalizeSnapshot(value) {
  if (!value || typeof value !== 'object' || typeof value.voiceChannelId !== 'string') return null;
  const clean = (track) => track && typeof track.url === 'string' && ({ title: String(track.title || 'Unknown').slice(0, 256), url: track.url, duration: Number.isFinite(track.duration) ? track.duration : 0, author: String(track.author || '').slice(0, 256), source: String(track.source || 'youtube'), ...(typeof track.spotifyQuery === 'string' && track.spotifyQuery ? { spotifyQuery: track.spotifyQuery.slice(0, 512) } : {}) });
  return {
    voiceChannelId: value.voiceChannelId,
    textChannelId: typeof value.textChannelId === 'string' ? value.textChannelId : null,
    current: clean(value.current),
    tracks: (Array.isArray(value.tracks) ? value.tracks : []).slice(0, MAX_PERSISTED_TRACKS).map(clean).filter(Boolean),
    loop: ['off', 'track', 'queue'].includes(value.loop) ? value.loop : 'off',
    position: Number.isFinite(value.position) && value.position >= 0 ? Math.floor(value.position) : 0,
  };
}

module.exports = { snapshotQueue, normalizeSnapshot, MAX_PERSISTED_TRACKS };

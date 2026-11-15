function youtubeVideoId(track) {
  try {
    const url = new URL(track?.url);
    const host = url.hostname.toLowerCase();
    if (host === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0] || null;
    if (!['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host)) return null;
    if (url.pathname === '/watch') return url.searchParams.get('v');
    return url.pathname.match(/^\/(?:shorts|live|embed)\/([^/]+)/)?.[1] || null;
  } catch {
    return null;
  }
}

function rememberVideo(history, track, limit = 50) {
  const id = youtubeVideoId(track);
  if (!id) return (history || []).slice(-limit);
  return [...(history || []), id].slice(-limit);
}

function chooseUnplayed(tracks, history = []) {
  const recent = new Set(history);
  return (tracks || []).find((track) => {
    const id = youtubeVideoId(track);
    return id && !recent.has(id);
  }) || null;
}

module.exports = { youtubeVideoId, rememberVideo, chooseUnplayed };

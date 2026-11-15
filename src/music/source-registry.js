function selectSource(query, sources, fallback) {
  return sources.find((source) => source.canHandle?.(query)) || fallback;
}

function attachSource(tracks, source) {
  for (const track of tracks) if (!track.source) track.source = source.name;
  return tracks;
}

module.exports = { selectSource, attachSource };

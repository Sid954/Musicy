function validPosition(position, length) {
  return Number.isInteger(position) && position >= 1 && position <= length;
}

function removeAt(tracks, position) {
  if (!validPosition(position, tracks.length)) return null;
  return tracks.splice(position - 1, 1)[0];
}

function moveTrack(tracks, from, to) {
  if (!validPosition(from, tracks.length) || !validPosition(to, tracks.length)) return false;
  const [track] = tracks.splice(from - 1, 1);
  tracks.splice(to - 1, 0, track);
  return true;
}

function shuffleTracks(tracks, random = Math.random) {
  for (let i = tracks.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
  }
  return tracks;
}

function takeFromPosition(tracks, position) {
  if (!validPosition(position, tracks.length)) return null;
  const [track] = tracks.splice(position - 1, 1);
  return { track, discarded: position - 1 };
}

module.exports = { validPosition, removeAt, moveTrack, shuffleTracks, takeFromPosition };

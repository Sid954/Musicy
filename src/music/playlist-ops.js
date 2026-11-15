const MAX_PLAYLISTS = 25;
const MAX_TRACKS = 200;
const MAX_NAME_LENGTH = 32;

function normalizeName(value) {
  const name = String(value || '').trim();
  if (!name || name.length > MAX_NAME_LENGTH) throw new Error('Playlist names must be 1–32 characters.');
  return name;
}

function createPlaylist(data, userId, rawName) {
  const name = normalizeName(rawName);
  const lists = { ...(data[userId] || {}) };
  if (lists[name]) throw new Error('A playlist with that name already exists.');
  if (Object.keys(lists).length >= MAX_PLAYLISTS) throw new Error('You have reached the 25-playlist limit.');
  lists[name] = [];
  return { ...data, [userId]: lists };
}

function deletePlaylist(data, userId, name) {
  const lists = { ...(data[userId] || {}) };
  if (!lists[name]) throw new Error('Playlist not found.');
  delete lists[name];
  return { ...data, [userId]: lists };
}

function addTracks(data, userId, name, tracks) {
  const lists = { ...(data[userId] || {}) };
  if (!lists[name]) throw new Error('Playlist not found.');
  const current = lists[name];
  if (current.length + tracks.length > MAX_TRACKS) throw new Error('Playlists can contain at most 200 tracks.');
  const stored = tracks.map((track) => ({
    title: String(track.title || 'Unknown').slice(0, 256),
    url: String(track.spotifyQuery
      ? `https://www.youtube.com/results?search_query=${encodeURIComponent(track.spotifyQuery)}`
      : track.url || ''),
    duration: Number.isFinite(track.duration) ? track.duration : 0,
    author: String(track.author || '').slice(0, 256),
    ...(track.spotifyQuery ? { spotifyQuery: String(track.spotifyQuery).slice(0, 512) } : {}),
  }));
  lists[name] = [...current, ...stored];
  return { ...data, [userId]: lists };
}

function removeTrack(data, userId, name, position) {
  const lists = { ...(data[userId] || {}) };
  if (!lists[name]) throw new Error('Playlist not found.');
  if (!Number.isInteger(position) || position < 1 || position > lists[name].length) throw new Error('That playlist position does not exist.');
  lists[name] = lists[name].filter((_track, index) => index !== position - 1);
  return { ...data, [userId]: lists };
}

module.exports = { normalizeName, createPlaylist, deletePlaylist, addTracks, removeTrack, MAX_PLAYLISTS, MAX_TRACKS, MAX_NAME_LENGTH };

// Per-server listening statistics (bounded). Pure operations + a persistent singleton.
const path = require('node:path');
const { createJsonStore } = require('../json-store');
const { trackKey } = require('./collection');

const MAX_TRACKS = 500;
const MAX_USERS = 500;

const emptyGuild = () => ({ totalPlays: 0, totalSeconds: 0, tracks: {}, users: {} });

function guildOf(data, guildId) {
  const key = String(guildId);
  if (!data[key]) data[key] = emptyGuild();
  return data[key];
}

// Keep only the `max` best entries by (primary desc, lastAt desc).
function trimTo(map, max, primary) {
  const entries = Object.entries(map);
  if (entries.length <= max) return map;
  entries.sort((a, b) => (b[1][primary] - a[1][primary]) || ((b[1].lastAt || 0) - (a[1].lastAt || 0)));
  return Object.fromEntries(entries.slice(0, max));
}

// A track started playing.
function applyPlay(data, guildId, track, now = Date.now()) {
  if (!track) return data;
  const guild = guildOf(data, guildId);
  const key = trackKey(track);
  const entry = guild.tracks[key] || { title: String(track.title || 'Unknown').slice(0, 120), url: String(track.url || '').slice(0, 300), plays: 0 };
  entry.plays += 1;
  entry.lastAt = now;
  entry.title = String(track.title || entry.title).slice(0, 120);
  guild.tracks[key] = entry;
  guild.totalPlays += 1;
  if (track.requestedById) {
    const user = guild.users[track.requestedById] || { plays: 0, seconds: 0 };
    user.plays += 1;
    user.lastAt = now;
    guild.users[track.requestedById] = user;
  }
  guild.tracks = trimTo(guild.tracks, MAX_TRACKS, 'plays');
  guild.users = trimTo(guild.users, MAX_USERS, 'plays');
  return data;
}

// Listening time (source seconds) for a finished/skipped track, credited to whoever requested it.
function applyListen(data, guildId, userId, seconds, now = Date.now()) {
  const amount = Math.round(Number(seconds));
  if (!Number.isFinite(amount) || amount <= 0) return data;
  const guild = guildOf(data, guildId);
  guild.totalSeconds += amount;
  if (userId) {
    const user = guild.users[userId] || { plays: 0, seconds: 0 };
    user.seconds += amount;
    user.lastAt = now;
    guild.users[userId] = user;
    guild.users = trimTo(guild.users, MAX_USERS, 'plays');
  }
  return data;
}

const sorted = (map, primary) => Object.entries(map || {})
  .map(([id, value]) => ({ id, ...value }))
  .sort((a, b) => (b[primary] - a[primary]) || ((b.lastAt || 0) - (a.lastAt || 0)));

const rankTracks = (data, guildId) => sorted(data[String(guildId)]?.tracks, 'plays');
const rankUsers = (data, guildId) => sorted(data[String(guildId)]?.users, 'plays');
const summarize = (data, guildId) => {
  const guild = data[String(guildId)] || emptyGuild();
  return { totalPlays: guild.totalPlays, totalSeconds: guild.totalSeconds, uniqueTracks: Object.keys(guild.tracks).length, listeners: Object.keys(guild.users).length };
};

const store = createJsonStore({ filePath: path.join(__dirname, '..', '..', 'data', 'stats.json'), name: 'stats.json' });
const singleton = {
  load: () => store.load(),
  flush: () => store.flush(),
  recordPlay: (guildId, track) => { store.mutate((data) => applyPlay(data, guildId, track)); },
  recordListen: (guildId, userId, seconds) => { store.mutate((data) => applyListen(data, guildId, userId, seconds)); },
  topTracks: (guildId) => rankTracks(store.get(), guildId),
  topUsers: (guildId) => rankUsers(store.get(), guildId),
  summary: (guildId) => summarize(store.get(), guildId),
};

// Pure functions (take the data object) are exported under apply*/rank* names; the singleton wraps them with the file store.
module.exports = { MAX_TRACKS, MAX_USERS, applyPlay, applyListen, rankTracks, rankUsers, summarize, ...singleton };

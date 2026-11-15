// Curated internet-radio stations (direct MP3 streams, verified to play with ffmpeg) + reconnect policy.
const STATIONS = Object.freeze([
  { id: 'groovesalad', name: 'SomaFM · Groove Salad', genre: 'Chilled downtempo beats', url: 'https://ice1.somafm.com/groovesalad-128-mp3' },
  { id: 'fluid', name: 'SomaFM · Fluid', genre: 'Instrumental hip-hop, future soul', url: 'https://ice1.somafm.com/fluid-128-mp3' },
  { id: 'lush', name: 'SomaFM · Lush', genre: 'Sensuous female vocals, mellow', url: 'https://ice1.somafm.com/lush-128-mp3' },
  { id: 'dronezone', name: 'SomaFM · Drone Zone', genre: 'Ambient space music', url: 'https://ice1.somafm.com/dronezone-128-mp3' },
  { id: 'spacestation', name: 'SomaFM · Space Station', genre: 'Spaced-out electronica', url: 'https://ice1.somafm.com/spacestation-128-mp3' },
  { id: 'secretagent', name: 'SomaFM · Secret Agent', genre: 'Spy-movie lounge', url: 'https://ice1.somafm.com/secretagent-128-mp3' },
  { id: 'beatblender', name: 'SomaFM · Beat Blender', genre: 'Deep house and downtempo', url: 'https://ice1.somafm.com/beatblender-128-mp3' },
  { id: 'defcon', name: 'SomaFM · DEF CON Radio', genre: 'Music for hacking', url: 'https://ice1.somafm.com/defcon-128-mp3' },
  { id: 'suburbsofgoa', name: 'SomaFM · Suburbs of Goa', genre: 'Desi-influenced beats', url: 'https://ice1.somafm.com/suburbsofgoa-128-mp3' },
  { id: 'indiepop', name: 'SomaFM · Indie Pop Rocks', genre: 'Indie pop and rock', url: 'https://ice1.somafm.com/indiepop-128-mp3' },
  { id: 'folkfwd', name: 'SomaFM · Folk Forward', genre: 'Indie folk and alt-country', url: 'https://ice1.somafm.com/folkfwd-128-mp3' },
  { id: 'sonicuniverse', name: 'SomaFM · Sonic Universe', genre: 'Jazz and avant-garde', url: 'https://ice1.somafm.com/sonicuniverse-128-mp3' },
  { id: 'rp-main', name: 'Radio Paradise · Main Mix', genre: 'Eclectic hand-picked mix', url: 'https://stream.radioparadise.com/mp3-128' },
  { id: 'rp-mellow', name: 'Radio Paradise · Mellow Mix', genre: 'Smooth and relaxed', url: 'https://stream.radioparadise.com/mellow-128' },
  { id: 'rp-rock', name: 'Radio Paradise · Rock Mix', genre: 'Rock', url: 'https://stream.radioparadise.com/rock-128' },
  { id: 'rp-world', name: 'Radio Paradise · Global Mix', genre: 'World and etc.', url: 'https://stream.radioparadise.com/world-etc-128' },
]);

const findStation = (id) => STATIONS.find((station) => station.id === id) || null;

// A live, directly streamable track (no yt-dlp lookup needed). `station` marks it for auto-reconnect.
function stationToTrack(station) {
  return {
    title: station.name,
    url: station.url,
    duration: 0,
    isLive: true,
    thumbnail: null,
    author: station.genre,
    source: 'ytdlp-generic',
    station: station.id,
  };
}

// Select-menu options (Discord: max 25 options, label/description <= 100 chars).
function buildStationOptions(stations = STATIONS) {
  return stations.slice(0, 25).map((station) => ({
    label: station.name.slice(0, 100),
    value: station.id,
    description: station.genre.slice(0, 100),
  }));
}

// Reconnect when a live stream drops: at most `max` attempts per `windowMs`, then give up.
function nextReconnect(history, now = Date.now(), { max = 5, windowMs = 60_000 } = {}) {
  const recent = (history || []).filter((at) => now - at < windowMs);
  if (recent.length >= max) return { allow: false, history: recent };
  return { allow: true, history: [...recent, now] };
}

module.exports = { STATIONS, findStation, stationToTrack, buildStationOptions, nextReconnect };

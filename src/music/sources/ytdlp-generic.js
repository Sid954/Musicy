const youtube = require('./youtube');
const { spawn } = require('node:child_process');
const { validateHttpUrl, validatePublicHttpUrl } = require('./url-safety');
const { Transform } = require('node:stream');
const { wireFfmpegOutput } = require('./stream-process');
const { liveSafeFilters } = require('../effects');
const { track: trackProcess } = require('../../process-registry');

function canHandle(query) {
  try {
    const url = validateHttpUrl(query);
    return !youtube.canHandle(query);
  } catch {
    return false;
  }
}

function isDirectAudioPath(url) {
  return /\.(?:aac|aif|aiff|flac|m4a|mp3|oga|ogg|opus|wav|weba|webm)(?:$|[?#])/i.test(url);
}

async function resolve(query) {
  if (/^scsearch\d*:/i.test(query)) {
    const match = query.match(/^scsearch(\d*):(.*)$/i);
    const count = youtube.clampSearchCount(match[1] || 16);
    return youtube.resolveTarget(`scsearch${count}:${match[2]}`, count);
  }
  await validatePublicHttpUrl(query);
  if (isDirectAudioPath(query)) {
    const url = new URL(query);
    let filename;
    try { filename = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || 'Internet radio'); }
    catch { filename = 'Internet radio'; }
    return [{ title: filename.replace(/\.[^.]+$/, '') || 'Internet radio', url: query, duration: 0, isLive: true, thumbnail: null, author: url.hostname }];
  }
  return youtube.resolveUrl(query);
}

async function stream(track, options) {
  await validatePublicHttpUrl(track.url);
  if (track.isLive) return spawnRadio(track, options);
  return youtube.stream(track, options);
}

// Live streams get the same loudness leveling / EQ / volume as songs (tempo filters are dropped) and reconnect
// on network drops. Without -reconnect a dropped connection ends the stream.
function buildRadioArgs(url, { filters = [], volume = 1 } = {}) {
  const audioFilters = liveSafeFilters(filters);
  if (Number.isFinite(volume) && volume !== 1) audioFilters.push(`volume=${volume}`);
  if (Number.isFinite(volume) && volume > 1) audioFilters.push('alimiter=limit=0.95');
  return [
    '-loglevel', 'error', '-protocol_whitelist', 'http,https,tcp,tls,crypto',
    '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5',
    '-i', url, '-vn',
    ...(audioFilters.length ? ['-af', audioFilters.join(',')] : []),
    '-c:a', 'libopus', '-b:a', '96k', '-ar', '48000', '-ac', '2', '-f', 'ogg', 'pipe:1',
  ];
}

function spawnRadio(track, options = {}) {
  // Live streams run until stopped, so they are never swept by age (only killed on exit / when stopped).
  const ff = trackProcess(spawn(require('ffmpeg-static'), buildRadioArgs(track.url, options), {
    stdio: ['ignore', 'pipe', 'ignore'],
  }), { label: 'ffmpeg (radio)', maxAgeMs: Infinity });
  const output = new Transform({ transform(chunk, _encoding, callback) { callback(null, chunk); } });
  const killChild = (child) => { if (child && child.exitCode === null) { try { child.kill('SIGKILL'); } catch {} } };
  wireFfmpegOutput({ ff, output, killChild });
  let killed = false;
  const kill = () => {
    if (killed) return;
    killed = true;
    killChild(ff);
    if (!output.destroyed && !output.readableEnded) output.destroy();
  };
  return { stream: output, kill, get outputBytes() { return 0; } };
}

async function prefetch(track, options) {
  await validatePublicHttpUrl(track.url);
  return youtube.prefetch(track, options);
}

module.exports = { name: 'ytdlp-generic', canHandle, resolve, stream, prefetch, isDirectAudioPath, buildRadioArgs };

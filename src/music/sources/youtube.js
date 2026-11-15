// YouTube source: metadata + streaming via yt-dlp piped into ffmpeg (Ogg/Opus).
// Source interface: { name, resolve(query) -> Track[], stream(track, opts) -> Promise<{ stream, kill }> }
const { spawn } = require('child_process');
const { Transform } = require('stream');
const fs = require('fs');
const path = require('path');
const ffmpegPath = require('ffmpeg-static');
const { dest: bundledYtdlp } = require('../../../scripts/update-ytdlp');
const { createResolveCache } = require('../resolve-cache');
const { trackThumbnail } = require('../thumbnail');
const { track: trackProcess } = require('../../process-registry');
const { buildFadeFilters } = require('../effects');
const { wireStreamProcesses } = require('./stream-process');

const ytdlp = () => (fs.existsSync(bundledYtdlp) ? bundledYtdlp : 'yt-dlp');

function killChild(child) {
  if (!child || child.exitCode !== null) return;
  try { child.kill('SIGKILL'); } catch {}
}

function baseArgs() {
  const args = ['--no-warnings', '--no-cache-dir', '--ignore-config'];
  const cookies = process.env.YTDLP_COOKIES;
  if (cookies && fs.existsSync(path.resolve(cookies))) args.push('--cookies', path.resolve(cookies));
  return args;
}

function classifyYtdlpError(stderr) {
  const text = String(stderr || '').toLowerCase();
  let code = 'UNKNOWN';

  if (/age.?restricted|confirm your age|age verification|may be inappropriate for some users/.test(text)) code = 'AGE_RESTRICTED';
  else if (/sign in to confirm|confirm you.re not a bot|bot.?check|not a bot/.test(text)) code = 'BOT_CHECK';
  else if (/geo.?restrict|not available in (your|the) (country|region)|blocked in your country|country.?restricted|not made this video available in your country/.test(text)) code = 'GEO_BLOCKED';
  else if (/live event will begin|live stream is not currently available|live stream.*not available|premieres in/.test(text)) code = 'LIVE_UNSUPPORTED';
  else if (/private video|video is private|video unavailable|video is unavailable|has been removed|does not exist|not available anymore/.test(text)) code = 'UNAVAILABLE';
  else if (/network is unreachable|unable to download|timed out|timeout|connection (?:reset|refused|aborted)|temporary failure in name resolution|name or service not known|http error 429|too many requests/.test(text)) code = 'NETWORK';

  const messages = {
    BOT_CHECK: 'YouTube is asking the bot to sign in. Configure YTDLP_COOKIES with a valid cookies.txt file and restart the bot.',
    AGE_RESTRICTED: "This video is age-restricted and can't be played by the bot.",
    UNAVAILABLE: 'This video is unavailable or private.',
    GEO_BLOCKED: "This video isn't available in the bot's region.",
    LIVE_UNSUPPORTED: "This live stream can't be played right now.",
    NETWORK: 'YouTube could not be reached. Please try again shortly.',
    UNKNOWN: "YouTube couldn't process that request. Please try another video or search.",
  };
  return { code, message: messages[code] };
}

// Runtime health signals for /admin cookies (in memory only).
const health = { lastBotCheckAt: 0, botCheckCount: 0, jsRuntimeRetries: 0, lastJsRetryAt: 0 };
const getHealth = () => ({ ...health });

function ytdlpError(stderr, exitCode) {
  const classified = classifyYtdlpError(stderr);
  if (classified.code === 'BOT_CHECK') {
    health.lastBotCheckAt = Date.now();
    health.botCheckCount += 1;
  }
  const error = new Error(classified.message);
  error.code = classified.code;
  if (exitCode !== undefined) error.exitCode = exitCode;
  return error;
}

function run(args, { signal } = {}) {
  return new Promise((resolve, reject) => {
    const p = trackProcess(spawn(ytdlp(), args, { stdio: ['ignore', 'pipe', 'pipe'] }), { label: 'yt-dlp', maxAgeMs: 5 * 60_000 });
    let out = '';
    let err = '';
    let settled = false;
    const cancel = () => {
      if (settled) return;
      settled = true;
      killChild(p);
      reject(new Error('yt-dlp request cancelled'));
    };
    if (signal?.aborted) return cancel();
    signal?.addEventListener('abort', cancel, { once: true });
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', cancel);
      reject(ytdlpError(e.message));
    });
    p.on('close', (code) => {
      signal?.removeEventListener('abort', cancel);
      if (settled) return;
      settled = true;
      if (code === 0) resolve(out);
      else if (!signal?.aborted) reject(ytdlpError(err, code));
      else reject(new Error('yt-dlp request cancelled'));
    });
  });
}

function toTrack(j) {
  return {
    title: j.title || 'Unknown',
    url: j.webpage_url || j.url || `https://www.youtube.com/watch?v=${j.id}`,
    duration: j.duration || 0,
    isLive: Boolean(j.is_live),
    thumbnail: j.thumbnail || (j.thumbnails && j.thumbnails.length ? j.thumbnails[j.thumbnails.length - 1].url : null) || trackThumbnail({ url: j.webpage_url || j.url || (j.id ? `https://www.youtube.com/watch?v=${j.id}` : '') }),
    author: j.uploader || j.channel || '',
    ...(j.playlist_title || j.playlist ? { playlistTitle: String(j.playlist_title || j.playlist).slice(0, 100) } : {}),
  };
}

const isUrl = (s) => /^https?:\/\//i.test(s);
const canHandle = (query) => {
  try {
    const url = new URL(query);
    return ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'music.youtube.com'].includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
};

// Playlists load up to this many tracks (the server's maxQueueLength setting still applies on enqueue).
const PLAYLIST_LIMIT = 200;

async function resolveTarget(target, limit = PLAYLIST_LIMIT) {
  const out = await run([...baseArgs(), '--flat-playlist', '--dump-json', '--playlist-end', String(limit), target]);
  const tracks = out.split('\n').filter(Boolean).map((line) => toTrack(JSON.parse(line)));
  if (!tracks.length) throw new Error('No results found.');
  return tracks;
}

async function resolveUrl(url, limit = 50) {
  return resolveTarget(url, limit);
}

async function resolveMix(videoId, limit = 50) {
  if (!/^[A-Za-z0-9_-]+$/.test(videoId || '')) throw new Error('Invalid YouTube video ID.');
  return resolveTarget(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&list=RD${encodeURIComponent(videoId)}`, limit);
}

// Fields printed by a single yt-dlp call that both resolves metadata and selects the audio format.
const AUDIO_PRINT = '%(.{id,title,duration,is_live,thumbnail,uploader,channel,webpage_url,url,acodec,ext})j';
const URL_MIN_REMAINING_MS = 120_000;
const URL_FALLBACK_MAX_AGE_MS = 20 * 60_000;

// googlevideo URLs carry an `expire` unix timestamp; fall back to a fixed age if absent.
function audioUrlExpiry(audioUrl) {
  try {
    const expire = Number(new URL(audioUrl).searchParams.get('expire'));
    return Number.isFinite(expire) && expire > 0 ? expire * 1000 : 0;
  } catch {
    return 0;
  }
}

function applyAudio(track, info, now = Date.now()) {
  if (!track || !info || info.is_live || !/^https?:\/\//i.test(String(info.url || ''))) return track;
  track.prefetchedAudioUrl = info.url;
  track.audioUrlAt = now;
  track.audioUrlExpiresAt = audioUrlExpiry(info.url);
  track.audioCodec = String(info.acodec || '');
  return track;
}

function isAudioUrlFresh(track, now = Date.now()) {
  if (!track?.prefetchedAudioUrl) return false;
  if (track.audioUrlExpiresAt) return track.audioUrlExpiresAt - now > URL_MIN_REMAINING_MS;
  if (!track.audioUrlAt) return true; // age unknown (set outside applyAudio): let ffmpeg try, retry path covers failures
  return now - track.audioUrlAt < URL_FALLBACK_MAX_AGE_MS;
}

// A single video (search text, /watch?v=, youtu.be/<id>, /shorts/) can use the one-call fast path.
// Playlists, mixes and channels keep the flat resolve.
function isSingleVideoQuery(query) {
  if (!isUrl(query)) return true;
  try {
    const url = new URL(query);
    if (!canHandle(query) || url.searchParams.has('list')) return false;
    const host = url.hostname.toLowerCase();
    if (host === 'youtu.be') return url.pathname.length > 1;
    return (url.pathname === '/watch' && url.searchParams.has('v')) || url.pathname.startsWith('/shorts/');
  } catch {
    return false;
  }
}

// yt-dlp prefers a JavaScript runtime for YouTube (extraction without one is deprecated and may lose formats).
// Using one costs ~1 s per lookup, so by default ("auto") it is only used as ONE retry when an extraction fails
// for an unexplained reason. YTDLP_JS_RUNTIME=always forces it, =off never uses it. Node itself is the runtime.
function jsRuntimeMode(value = process.env.YTDLP_JS_RUNTIME) {
  const mode = String(value || 'auto').toLowerCase();
  return ['auto', 'always', 'off'].includes(mode) ? mode : 'auto';
}
const jsRuntimeArgs = () => ['--js-runtimes', `node:${process.execPath}`];

async function extractAudio(target, { signal, format = 'bestaudio', runner = run, mode = jsRuntimeMode() } = {}) {
  const attempt = async (withRuntime) => {
    // skip=hls: audio comes from plain https formats, so the HLS manifest request is wasted time (~0.4s).
    const out = await runner([...baseArgs(), ...(withRuntime ? jsRuntimeArgs() : []), '--extractor-args', 'youtube:skip=hls', '--no-playlist', '-f', format, '--print', AUDIO_PRINT, target], { signal });
    const line = out.split(/\r?\n/).find(Boolean);
    if (!line) throw new Error('No results found.');
    return JSON.parse(line);
  };
  if (mode === 'always') return attempt(true);
  try {
    return await attempt(false);
  } catch (error) {
    // Known failures (private, geo-blocked, bot check), cancellations and empty results are final.
    if (mode === 'off' || signal?.aborted || (error.code && error.code !== 'UNKNOWN') || error.message === 'No results found.') throw error;
    try {
      const info = await attempt(true);
      health.jsRuntimeRetries += 1;
      health.lastJsRetryAt = Date.now();
      return info;
    } catch {
      throw error; // report the original, user-friendly error
    }
  }
}

// Resolved single tracks (with direct audio URL) are cached so repeat plays skip yt-dlp entirely.
const resolveCache = createResolveCache({ isFresh: (track) => isAudioUrlFresh(track) });

async function resolve(query) {
  const target = isUrl(query) && canHandle(query) ? query : `ytsearch1:${query}`;
  if (!isSingleVideoQuery(query)) return resolveTarget(target);
  const cached = resolveCache.get(query);
  if (cached) return [cached];
  try {
    const info = await extractAudio(target);
    const track = applyAudio(toTrack(info), info);
    resolveCache.set(query, track);
    return [resolveCache.get(query) || track];
  } catch (error) {
    // Known failures (private, geo-blocked, ...) are final; odd extractor/format errors fall back to the slow path.
    if (error.code && error.code !== 'UNKNOWN') throw error;
    return resolveTarget(target);
  }
}

function clampSearchCount(count) {
  return Math.max(1, Math.min(16, Math.floor(Number(count) || 8)));
}

async function resolveMany(query, count = 8) {
  const limit = clampSearchCount(count);
  return resolveTarget(`ytsearch${limit}:${query}`, limit);
}

// Resume ranged HTTP downloads after the server drops the connection (also at a premature EOF).
const HTTP_RECONNECT_ARGS = Object.freeze(['-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_at_eof', '1', '-reconnect_delay_max', '5']);

// copyOpus: the source is already Opus and no filter/volume is applied, so remux instead of re-encoding
// (near-zero CPU and no generation loss). Ogg pages are flushed every 20ms so audio starts immediately.
function buildFfmpegArgs({ seek = 0, filters = [], volume = 1, input = 'pipe:0', copyOpus = false, fade = null } = {}) {
  const args = ['-loglevel', 'error'];
  if (Number.isFinite(seek) && seek > 0) args.push('-ss', String(seek));
  if (/^https?:\/\//i.test(input)) {
    args.push('-protocol_whitelist', 'http,https,tcp,tls,crypto');
    // YouTube closes long-lived direct downloads (~2 min) while ffmpeg waits for the player to catch up; without
    // these options ffmpeg treats the dropped connection as the end of the song and it stops 30-60 s early.
    args.push(...HTTP_RECONNECT_ARGS);
  }
  args.push('-i', input, '-vn');

  const audioFilters = [...filters];
  if (fade) audioFilters.push(...buildFadeFilters(fade));
  if (Number.isFinite(volume) && volume !== 1) audioFilters.push(`volume=${volume}`);
  if (Number.isFinite(volume) && volume > 1) audioFilters.push('alimiter=limit=0.95');
  if (audioFilters.length) args.push('-af', audioFilters.join(','));

  if (copyOpus && !audioFilters.length) args.push('-c:a', 'copy');
  else args.push('-c:a', 'libopus', '-b:a', '96k', '-ar', '48000', '-ac', '2');
  args.push('-page_duration', '20000', '-f', 'ogg', 'pipe:1');
  return args;
}

function spawnStream(track, opts, directUrl) {
  const input = directUrl || 'pipe:0';
  const ff = trackProcess(spawn(ffmpegPath, buildFfmpegArgs({ ...opts, input }), {
    stdio: [directUrl ? 'ignore' : 'pipe', 'pipe', 'ignore'],
  }), { label: 'ffmpeg' });
  const dl = directUrl ? null : trackProcess(spawn(ytdlp(), [...baseArgs(), '--no-playlist', '-f', opts.format || 'bestaudio/best', '-o', '-', track.url], {
    stdio: ['ignore', 'pipe', 'pipe'],
  }), { label: 'yt-dlp' });
  let outputBytes = 0;
  const output = new Transform({
    transform(chunk, _encoding, callback) {
      outputBytes += chunk.length;
      callback(null, chunk);
    },
  });
  const kill = wireStreamProcesses({ ff, dl, output, makeError: ytdlpError, killChild });
  return { stream: output, kill, get outputBytes() { return outputBytes; } };
}

async function getAudioInfo(track, signal, format = 'bestaudio') {
  const info = await extractAudio(track.url, { signal, format });
  if (!/^https?:\/\//i.test(String(info.url || ''))) throw new Error('yt-dlp returned no audio URL');
  return info;
}

async function prefetch(track, { signal } = {}) {
  if (!track || !track.duration) return null;
  if (!track.prefetchPromise) {
    track.prefetchPromise = getAudioInfo(track, signal)
      .then((info) => {
        if (!signal?.aborted) applyAudio(track, info);
        return track.prefetchedAudioUrl || null;
      })
      .finally(() => { delete track.prefetchPromise; });
  }
  return track.prefetchPromise;
}

function clearAudioUrl(track) {
  if (!track) return;
  delete track.prefetchedAudioUrl;
  delete track.audioUrlAt;
  delete track.audioUrlExpiresAt;
}

// Returns a still-valid direct URL (once) or null; expired URLs are discarded.
function consumePrefetchedUrl(track) {
  const audioUrl = isAudioUrlFresh(track) ? track.prefetchedAudioUrl : null;
  clearAudioUrl(track);
  return audioUrl;
}

async function stream(track, { seek = 0, filters = [], volume = 1, signal, format = 'bestaudio/best', fade = null } = {}) {
  const opts = { seek, filters, volume, format, fade };
  // Fast path: a direct audio URL (from resolve/prefetch) goes straight into ffmpeg.
  // Fallback: yt-dlp -> ffmpeg pipe. Seeking without a cached URL extracts one first.
  if (track.prefetchPromise) await track.prefetchPromise;
  if (signal?.aborted) throw new Error('yt-dlp request cancelled');
  const codec = track.audioCodec;
  const prefetchedUrl = format === 'bestaudio/best' ? consumePrefetchedUrl(track) : (clearAudioUrl(track), null);
  if (prefetchedUrl) return spawnStream(track, { ...opts, copyOpus: codec === 'opus' }, prefetchedUrl);
  if (track.duration > 0 && seek > 0) {
    const info = await getAudioInfo(track, signal, format === 'ba*' ? 'ba*' : 'bestaudio');
    return spawnStream(track, { ...opts, copyOpus: info.acodec === 'opus' }, info.url);
  }
  // No direct URL yet (e.g. a saved-playlist entry): one short lookup gives ffmpeg a direct URL, so yt-dlp does not
  // keep running (and using CPU) for the whole song. If the lookup fails, fall back to the yt-dlp pipe.
  if (!track.isLive && /^https?:\/\//i.test(String(track.url || ''))) {
    try {
      const info = await getAudioInfo(track, signal, format === 'ba*' ? 'ba*' : 'bestaudio');
      if (signal?.aborted) throw new Error('yt-dlp request cancelled');
      return spawnStream(track, { ...opts, copyOpus: info.acodec === 'opus' }, info.url);
    } catch (error) {
      if (signal?.aborted) throw error;
    }
  }
  return spawnStream(track, opts);
}

module.exports = { HTTP_RECONNECT_ARGS, jsRuntimeMode, extractAudio, getHealth, resolveCache, name: 'youtube', canHandle, resolve, resolveUrl, resolveMix, resolveMany, resolveTarget, prefetch, stream, classifyYtdlpError, buildFfmpegArgs, clampSearchCount, PLAYLIST_LIMIT, consumePrefetchedUrl, toTrack, applyAudio, isAudioUrlFresh, isSingleVideoQuery, audioUrlExpiry };

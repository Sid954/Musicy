// Live self-test: launches the real helpers and checks the network. Used by `npm run selftest` and `/admin selftest`.
// Every external call is injectable so the logic is testable offline.
const { execFile } = require('node:child_process');
const dns = require('node:dns/promises');
const { runStartupChecks } = require('./startup-check');
const helperMemory = require('./music/helper-memory');

const KNOWN_VIDEO = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
const check = (level, name, message) => ({ level, name, message });

const defaultRun = (file, args, timeout = 15000) => new Promise((resolve, reject) => {
  execFile(file, args, { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => (error ? reject(Object.assign(error, { stderr })) : resolve(String(stdout))));
});

async function timed(fn) {
  const started = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - started };
}

async function runSelfTest({
  env = process.env,
  run = defaultRun,
  lookup = (host) => dns.lookup(host),
  resolveVideo = (query) => require('./music/sources/youtube').resolve(query),
  describeError = (error) => error.message,
  ffmpegPath = require('ffmpeg-static'),
  ytdlpPath = require('../scripts/update-ytdlp').dest,
  memory = () => process.memoryUsage().rss,
  readHelpers = () => helperMemory.readHelperProcesses(),
  startup = () => runStartupChecks({ env }),
  extra = [],
} = {}) {
  const results = [...startup()];

  try {
    const { value, ms } = await timed(() => run(ytdlpPath, ['--version'], 20000));
    results.push(check('ok', 'yt-dlp runs', `version ${String(value).trim()} (${ms} ms to start)`));
  } catch (error) {
    results.push(check('error', 'yt-dlp runs', `could not start: ${describeError(error)}`));
  }

  try {
    const { value, ms } = await timed(() => run(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'libopus', '-f', 'ogg', '-'], 15000));
    results.push(value !== undefined ? check('ok', 'ffmpeg encodes Opus', `${ms} ms`) : check('error', 'ffmpeg encodes Opus', 'no output'));
  } catch (error) {
    results.push(check('error', 'ffmpeg encodes Opus', `failed: ${describeError(error)}`));
  }

  for (const host of ['discord.com', 'www.youtube.com']) {
    try {
      await lookup(host);
      results.push(check('ok', `Network: ${host}`, 'reachable'));
    } catch (error) {
      results.push(check('error', `Network: ${host}`, `cannot resolve (${error.code || error.message})`));
    }
  }

  try {
    const { value, ms } = await timed(() => resolveVideo(KNOWN_VIDEO));
    results.push(value?.length ? check(ms > 15000 ? 'warn' : 'ok', 'YouTube lookup', `found a test video in ${ms} ms`) : check('error', 'YouTube lookup', 'returned no results'));
  } catch (error) {
    const blocked = error.code === 'BOT_CHECK';
    results.push(check('error', 'YouTube lookup', blocked
      ? 'YouTube asked this host to sign in (bot check). Set YTDLP_COOKIES (see /admin cookies).'
      : `failed: ${describeError(error)}`));
  }

  try {
    const { groups, totalMb } = helperMemory.groupHelpers(await readHelpers());
    const nodeMb = Math.round(memory() / 1048576);
    const limit = Number(env.MEMORY_LIMIT_MB) || 512;
    results.push(check('info', 'Memory', `${helperMemory.describeTotal({ nodeMb, helpersMb: totalMb, limitMb: limit })} (Node ${nodeMb} MB · helpers: ${helperMemory.formatHelpers(groups)})`));
  } catch {
    results.push(check('info', 'Memory', 'helper processes cannot be read on this system'));
  }

  return [...results, ...extra];
}

function summarize(results) {
  const count = (level) => results.filter((result) => result.level === level).length;
  return { errors: count('error'), warnings: count('warn'), ok: count('ok') + count('info') };
}

module.exports = { KNOWN_VIDEO, runSelfTest, summarize };

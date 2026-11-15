// Offline configuration checks run at startup (and by `npm run selftest`). Pure: every system access is injectable.
// Result shape: { level: 'ok' | 'info' | 'warn' | 'error', name, message }. Secrets are never included in messages.
const fs = require('node:fs');
const path = require('node:path');

const MIN_NODE_MAJOR = 18;
const ICON = { ok: '✅', info: 'ℹ️', warn: '⚠️', error: '❌' };

const check = (level, name, message) => ({ level, name, message });

function looksLikeBotToken(token) {
  const parts = String(token || '').split('.');
  return parts.length === 3 && parts.every((part) => /^[\w-]+$/.test(part)) && parts[0].length >= 18 && parts[2].length >= 20;
}

function major(version) {
  return Number(String(version || '').replace(/^v/, '').split('.')[0]);
}

function runStartupChecks({
  env = process.env,
  nodeVersion = process.versions.node,
  existsSync = fs.existsSync,
  ffmpegPath = safe(() => require('ffmpeg-static')),
  ytdlpPath = safe(() => require('../scripts/update-ytdlp').dest),
  dataDir = path.join(__dirname, '..', 'data'),
  canWriteDir = defaultCanWrite,
  hasModule = (name) => { try { require.resolve(name); return true; } catch { return false; } },
  voiceVersion = readVoiceVersion,
  loadDiscord = probeDiscordInstall,
} = {}) {
  const results = [];

  results.push(major(nodeVersion) >= MIN_NODE_MAJOR
    ? check('ok', 'Node.js', `v${nodeVersion}`)
    : check('error', 'Node.js', `v${nodeVersion} is too old; Node ${MIN_NODE_MAJOR} or newer is required.`));

  // A file deleted from node_modules (antivirus, a failed install) only shows up when the client is created.
  try {
    loadDiscord();
    results.push(check('ok', 'discord.js', 'installed and intact'));
  } catch (error) {
    results.push(check('error', 'discord.js', `the installation is damaged (${String(error?.message || error).split('\n')[0].slice(0, 160)}). Delete node_modules/discord.js and run \`npm install\`.`));
  }

  if (!env.DISCORD_TOKEN) results.push(check('error', 'Discord token', 'DISCORD_TOKEN is not set (see .env.example).'));
  else if (!looksLikeBotToken(env.DISCORD_TOKEN)) results.push(check('warn', 'Discord token', 'DISCORD_TOKEN is set but does not look like a bot token (3 dot-separated parts). Login will probably fail.'));
  else results.push(check('ok', 'Discord token', 'set'));

  if (!/^\d{15,25}$/.test(String(env.CLIENT_ID || ''))) results.push(check('warn', 'Client ID', 'CLIENT_ID is missing or not a number; `npm run deploy` needs it to register commands.'));
  else results.push(check('ok', 'Client ID', 'set'));

  // Discord requires DAVE end-to-end voice encryption; without these the bot "plays" in silence.
  const voice = voiceVersion();
  if (!voice || major(voice) !== 0 || Number(String(voice).split('.')[1]) < 19) results.push(check('error', 'Voice library', `@discordjs/voice ${voice || '(missing)'} is too old: Discord now requires 0.19 or newer (audio would be silent).`));
  else if (!hasModule('@snazzah/davey')) results.push(check('error', 'Voice encryption', 'The DAVE library (@snazzah/davey) is missing: Discord voice would connect but stay silent. Run `npm install`.'));
  else results.push(check('ok', 'Voice encryption', `@discordjs/voice ${voice} + DAVE`));

  results.push(ffmpegPath && existsSync(ffmpegPath)
    ? check('ok', 'ffmpeg', 'found')
    : check('error', 'ffmpeg', 'The bundled ffmpeg binary is missing (ffmpeg-static). Run `npm install` again; npm may have skipped its install script.'));

  results.push(ytdlpPath && existsSync(ytdlpPath)
    ? check('ok', 'yt-dlp', 'found')
    : check('warn', 'yt-dlp', 'not downloaded yet; it will be fetched automatically on start (needs internet).'));

  if (env.YTDLP_COOKIES) {
    results.push(existsSync(path.resolve(env.YTDLP_COOKIES))
      ? check('ok', 'YouTube cookies', 'file found')
      : check('warn', 'YouTube cookies', `YTDLP_COOKIES points to a file that does not exist (${path.basename(env.YTDLP_COOKIES)}); it will be ignored.`));
  } else {
    results.push(check('info', 'YouTube cookies', 'not configured (only needed if YouTube blocks your host)'));
  }

  if (env.BOT_OWNER_ID) {
    const ids = String(env.BOT_OWNER_ID).split(/[\s,]+/).filter(Boolean);
    results.push(ids.length && ids.every((id) => /^\d{5,25}$/.test(id))
      ? check('ok', 'Owner', `${ids.length} owner ID${ids.length === 1 ? '' : 's'} set (/admin enabled, error alerts by DM)`)
      : check('warn', 'Owner', 'BOT_OWNER_ID must be your numeric Discord user ID(s); /admin and error alerts are disabled.'));
  } else {
    results.push(check('info', 'Owner', 'BOT_OWNER_ID not set (/admin and error DMs are disabled)'));
  }

  if (env.MEMORY_LIMIT_MB && !(Number(env.MEMORY_LIMIT_MB) > 0)) results.push(check('warn', 'Memory limit', 'MEMORY_LIMIT_MB must be a positive number; using 512.'));
  if (env.LOG_LEVEL && !['debug', 'info', 'warn', 'error'].includes(String(env.LOG_LEVEL).toLowerCase())) results.push(check('warn', 'Log level', 'LOG_LEVEL must be debug, info, warn or error; using info.'));
  if (env.YTDLP_JS_RUNTIME && !['auto', 'always', 'off'].includes(String(env.YTDLP_JS_RUNTIME).toLowerCase())) results.push(check('warn', 'yt-dlp runtime', 'YTDLP_JS_RUNTIME must be auto, always or off; using auto.'));

  results.push(canWriteDir(dataDir)
    ? check('ok', 'Data folder', 'writable (settings, playlists, stats and logs are saved here)')
    : check('warn', 'Data folder', 'cannot write to the data folder; settings and playlists will NOT survive a restart.'));

  return results;
}

function safe(fn) {
  try { return fn(); } catch { return undefined; }
}

// Creating a Client loads every lazily required file (it throws if any were removed). Never connects.
function probeDiscordInstall() {
  const { Client } = require('discord.js');
  new Client({ intents: [1] }).destroy();
}

// The package's "exports" map hides package.json, so read it next to the resolved entry point instead.
function readVoiceVersion() {
  return safe(() => require('@discordjs/voice').version)
    || safe(() => require(path.join(path.dirname(require.resolve('@discordjs/voice')), '..', 'package.json')).version);
}

function defaultCanWrite(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, 'ok');
    fs.rmSync(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

const hasErrors = (results) => results.some((result) => result.level === 'error');
const formatResult = (result) => `${ICON[result.level] || '•'} ${result.name}: ${result.message}`;
const formatReport = (results) => results.map(formatResult).join('\n');

module.exports = { MIN_NODE_MAJOR, ICON, looksLikeBotToken, runStartupChecks, hasErrors, formatResult, formatReport };

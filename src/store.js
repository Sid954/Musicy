const fs = require('node:fs/promises');
const path = require('node:path');
const log = require('./log');

const DEFAULTS = Object.freeze({
  volume: 100,
  filterPresets: [],
  // Levels every song to the same loudness (see /normalize). It re-encodes audio (about 20x the CPU of passthrough),
  // so a CPU-limited host can start new servers with it off: LEVELING_DEFAULT=off.
  levelingEnabled: String(process.env.LEVELING_DEFAULT || '').toLowerCase() !== 'off',
  loudnessLevel: 'soft',
  sponsorBlock: false,
  djRole: null,
  textChannel: null,
  maxQueueLength: 500,
  maxTrackDuration: 10800,
  twentyFourSeven: false,
  autoplay: false,
  cleanupNowPlaying: 'edit',
  speed: 1,
  pitch: 0,
  eqPreset: 'flat',
  eqBands: {},
  fade: false,
  skipDuplicates: false,
  voiceStatus: false,
  jukebox: null,
});

function createStore({ filePath = path.join(__dirname, '..', 'data', 'settings.json'), debounceMs = 1000 } = {}) {
  let settings = {};
  let timer = null;
  let writeChain = Promise.resolve();
  let tempSequence = 0;

  function get(guildId) {
    return { ...DEFAULTS, ...(settings[String(guildId)] || {}) };
  }

  function write() {
    const snapshot = JSON.stringify(settings, null, 2);
    writeChain = writeChain.then(async () => {
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });
      const tempPath = `${filePath}.${process.pid}.${++tempSequence}.tmp`;
      try {
        await fs.writeFile(tempPath, `${snapshot}\n`, 'utf8');
        await fs.rename(tempPath, filePath);
      } catch (error) {
        await fs.rm(tempPath, { force: true }).catch(() => {});
        throw error;
      }
    });
    return writeChain;
  }

  function scheduleWrite() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      write().catch((error) => log.error('Failed to save settings:', error));
    }, debounceMs);
  }

  async function load() {
    clearTimeout(timer);
    timer = null;
    try {
      const contents = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(contents);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Settings file must contain an object');
      settings = parsed;
    } catch (error) {
      if (error.code === 'ENOENT') {
        settings = {};
        return;
      }
      settings = {};
      try {
        await fs.rm(`${filePath}.bad`, { force: true });
        await fs.rename(filePath, `${filePath}.bad`);
      } catch (backupError) {
        if (backupError.code !== 'ENOENT') log.error('Failed to back up corrupt settings:', backupError);
      }
    }
  }

  function set(guildId, patch) {
    const key = String(guildId);
    settings[key] = { ...(settings[key] || {}), ...patch };
    scheduleWrite();
    return get(key);
  }

  async function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
      await write();
    } else {
      await writeChain;
    }
  }

  return { get, set, load, flush };
}

const store = createStore();
module.exports = { ...store, createStore, DEFAULTS };

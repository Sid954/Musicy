const fs = require('node:fs/promises');
const path = require('node:path');
const ops = require('./playlist-ops');
const log = require('../log');

function createPlaylistStore({ filePath = path.join(__dirname, '..', '..', 'data', 'playlists.json'), debounceMs = 500 } = {}) {
  let data = {};
  let timer = null;
  let writeChain = Promise.resolve();
  let sequence = 0;

  async function load() {
    clearTimeout(timer);
    timer = null;
    try {
      const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
      data = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
      data = {};
      if (error.code !== 'ENOENT') {
        await fs.rename(filePath, `${filePath}.bad`).catch(() => {});
      }
    }
  }

  function scheduleWrite() {
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; flush().catch((error) => log.error('Failed to save playlists:', error)); }, debounceMs);
    timer.unref?.();
  }

  function mutate(operation) {
    data = operation(data);
    scheduleWrite();
    return data;
  }

  function write() {
    const snapshot = JSON.stringify(data, null, 2);
    writeChain = writeChain.then(async () => {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const temp = `${filePath}.${process.pid}.${++sequence}.tmp`;
      try {
        await fs.writeFile(temp, `${snapshot}\n`, 'utf8');
        await fs.rename(temp, filePath);
      } catch (error) {
        await fs.rm(temp, { force: true }).catch(() => {});
        throw error;
      }
    });
    return writeChain;
  }

  async function flush() {
    clearTimeout(timer);
    timer = null;
    await write();
  }

  return {
    load, flush,
    list(userId) { return Object.keys(data[String(userId)] || {}); },
    get(userId, name) { const value = data[String(userId)]?.[name]; return value ? value.map((track) => ({ ...track })) : null; },
    create(userId, name) { mutate((current) => ops.createPlaylist(current, String(userId), name)); },
    delete(userId, name) { mutate((current) => ops.deletePlaylist(current, String(userId), name)); },
    add(userId, name, tracks) { mutate((current) => ops.addTracks(current, String(userId), name, tracks)); },
    remove(userId, name, position) { mutate((current) => ops.removeTrack(current, String(userId), name, position)); },
  };
}

const store = createPlaylistStore();
module.exports = { ...store, createPlaylistStore };

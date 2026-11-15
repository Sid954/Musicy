// Tiny atomic, debounced JSON file store (object at the root).
// Nothing is ever written before load() succeeded once: tests and tools that never call load() cannot touch disk.
const fs = require('node:fs/promises');
const path = require('node:path');
const log = require('./log');

function createJsonStore({ filePath, debounceMs = 2000, name = path.basename(filePath) } = {}) {
  let data = {};
  let loaded = false;
  let timer = null;
  let chain = Promise.resolve();
  let sequence = 0;

  async function load() {
    clearTimeout(timer);
    timer = null;
    try {
      const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('root must be an object');
      data = parsed;
    } catch (error) {
      data = {};
      if (error.code !== 'ENOENT') {
        log.warn(`${name} was unreadable (${error.message}); starting fresh and keeping a .bad copy.`);
        await fs.rm(`${filePath}.bad`, { force: true }).catch(() => {});
        await fs.rename(filePath, `${filePath}.bad`).catch(() => {});
      }
    }
    loaded = true;
  }

  function write() {
    const snapshot = JSON.stringify(data);
    chain = chain.then(async () => {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const temp = `${filePath}.${process.pid}.${++sequence}.tmp`;
      try {
        await fs.writeFile(temp, snapshot, 'utf8');
        await fs.rename(temp, filePath);
      } catch (error) {
        await fs.rm(temp, { force: true }).catch(() => {});
        throw error;
      }
    });
    return chain;
  }

  function schedule() {
    if (!loaded) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      write().catch((error) => log.error(`Failed to save ${name}:`, error));
    }, debounceMs);
    timer.unref?.();
  }

  return {
    load,
    get: () => data,
    // `change(data)` may mutate in place or return a replacement object.
    mutate(change) {
      const result = change(data);
      if (result && typeof result === 'object') data = result;
      schedule();
      return data;
    },
    async flush() {
      if (!loaded) return;
      clearTimeout(timer);
      timer = null;
      await write();
    },
    get loaded() { return loaded; },
  };
}

module.exports = { createJsonStore };

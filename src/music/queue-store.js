const fs = require('node:fs/promises');
const path = require('node:path');
const { normalizeSnapshot } = require('./queue-persistence');
const log = require('../log');

function createQueueStore({ filePath = path.join(__dirname, '..', '..', 'data', 'queues.json'), debounceMs = 1000 } = {}) {
  let data = {};
  let timer = null;
  let chain = Promise.resolve();
  let sequence = 0;
  async function load() {
    try {
      const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
      data = Object.fromEntries(Object.entries(parsed || {}).map(([id, value]) => [id, normalizeSnapshot(value)]).filter(([, value]) => value));
    } catch (error) {
      data = {};
      if (error.code !== 'ENOENT') log.error('Failed to load saved queues:', error.message);
    }
    return data;
  }
  function flush() {
    clearTimeout(timer);
    timer = null;
    const snapshot = JSON.stringify(data, null, 2);
    chain = chain.then(async () => {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const temp = `${filePath}.${process.pid}.${++sequence}.tmp`;
      try { await fs.writeFile(temp, `${snapshot}\n`, 'utf8'); await fs.rename(temp, filePath); }
      catch (error) { await fs.rm(temp, { force: true }).catch(() => {}); throw error; }
    });
    return chain;
  }
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; flush().catch((error) => log.error('Failed to persist queues:', error)); }, debounceMs);
  }
  return {
    load,
    flush,
    get(guildId) { return data[String(guildId)] || null; },
    set(guildId, snapshot) { data[String(guildId)] = normalizeSnapshot(snapshot); schedule(); },
    delete(guildId) { delete data[String(guildId)]; schedule(); },
    entries() { return Object.entries(data); },
  };
}

module.exports = { createQueueStore };

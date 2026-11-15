// Size-rotated log file: bot.log, bot.log.1, bot.log.2 ... (keeps disk use bounded on a 1 GB host).
// Writes are queued and never throw into the bot; a broken disk must not break playback.
const fs = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_KEEP = 3; // current file + this many older ones

function createFileSink({ filePath, maxBytes = DEFAULT_MAX_BYTES, keep = DEFAULT_KEEP, files = fs } = {}) {
  let size = null; // unknown until the first write
  let chain = Promise.resolve();
  let failures = 0;

  async function currentSize() {
    if (size !== null) return size;
    try { size = (await files.stat(filePath)).size; } catch { size = 0; }
    return size;
  }

  async function rotate() {
    // bot.log.(keep-1) is deleted, the rest shift up by one, bot.log becomes bot.log.1
    await files.rm(`${filePath}.${keep}`, { force: true }).catch(() => {});
    for (let n = keep - 1; n >= 1; n--) await files.rename(`${filePath}.${n}`, `${filePath}.${n + 1}`).catch(() => {});
    await files.rename(filePath, `${filePath}.1`).catch(() => {});
    size = 0;
  }

  function write(line) {
    const text = `${String(line).replace(/\r?\n$/, '')}\n`;
    const bytes = Buffer.byteLength(text);
    chain = chain.then(async () => {
      await files.mkdir(path.dirname(filePath), { recursive: true });
      if ((await currentSize()) + bytes > maxBytes && size > 0) await rotate();
      await files.appendFile(filePath, text, 'utf8');
      size += bytes;
    }).catch(() => { failures += 1; });
    return chain;
  }

  // Last `count` lines, reading older rotated files if the current one is short.
  async function tail(count = 20) {
    const lines = [];
    for (let n = 0; n <= keep && lines.length < count; n++) {
      try {
        const text = await files.readFile(n === 0 ? filePath : `${filePath}.${n}`, 'utf8');
        lines.unshift(...text.split(/\r?\n/).filter(Boolean));
      } catch { /* file does not exist */ }
    }
    return lines.slice(-count);
  }

  return { write, tail, flush: () => chain, get failures() { return failures; } };
}

// Settings from the environment: LOG_FILE (path, or "off"), LOG_MAX_MB, LOG_KEEP.
function fileLogOptions(env = process.env, baseDir = path.join(__dirname, '..')) {
  const target = String(env.LOG_FILE || '').trim();
  if (target.toLowerCase() === 'off') return null;
  const mb = Number(env.LOG_MAX_MB);
  const keep = Math.floor(Number(env.LOG_KEEP));
  return {
    filePath: path.resolve(baseDir, target || path.join('data', 'logs', 'bot.log')),
    maxBytes: mb > 0 ? Math.round(mb * 1024 * 1024) : DEFAULT_MAX_BYTES,
    keep: keep >= 1 && keep <= 20 ? keep : DEFAULT_KEEP,
  };
}

let active = null;
// Called once at startup (never in tests): starts writing every log line to the file.
function enableFileLogging(log, env = process.env) {
  const options = fileLogOptions(env);
  if (!options || active) return active;
  active = createFileSink(options);
  log.addListener(({ line }) => { active.write(line); });
  return active;
}

module.exports = { DEFAULT_MAX_BYTES, DEFAULT_KEEP, createFileSink, fileLogOptions, enableFileLogging, getFileLog: () => active };

// yt-dlp's Linux binary is a PyInstaller "onefile": every launch unpacks ~30-40 MB into the temp folder. On hosts where
// /tmp is small or memory-backed that fails ("Failed to extract ..._ARC4.abi3.so: decompression resulted in return
// code -1"). We point its temp folder at our own data folder (real disk) and sweep leftovers from killed runs.
const fs = require('fs');
const path = require('path');

const TMP_DIR = path.join(__dirname, '..', 'data', 'tmp');
let prepared = false;

function prepareTmp({ mkdir = fs.mkdirSync } = {}) {
  if (prepared) return TMP_DIR;
  try { mkdir(TMP_DIR, { recursive: true }); } catch { /* fall back to the system temp folder */ }
  prepared = true;
  return TMP_DIR;
}

// Environment for yt-dlp child processes. Windows keeps its normal temp folder (it works there).
function ytdlpEnv(base = process.env, { platform = process.platform, dir } = {}) {
  if (platform === 'win32') return base;
  const tmp = dir || prepareTmp();
  return { ...base, TMPDIR: tmp, TEMP: tmp, TMP: tmp };
}

// Removes unpack folders (_MEI*) older than maxAgeMs that a killed yt-dlp left behind.
function sweepTmp({ dir = TMP_DIR, maxAgeMs = 10 * 60_000, now = Date.now(), readdir = fs.readdirSync, stat = fs.statSync, remove = fs.rmSync } = {}) {
  let removed = 0;
  let names = [];
  try { names = readdir(dir); } catch { return 0; }
  for (const name of names) {
    if (!name.startsWith('_MEI')) continue;
    try {
      if (now - stat(path.join(dir, name)).mtimeMs < maxAgeMs) continue;
      remove(path.join(dir, name), { recursive: true, force: true });
      removed++;
    } catch { /* ignore */ }
  }
  return removed;
}

module.exports = { ytdlpEnv, sweepTmp, prepareTmp, TMP_DIR };

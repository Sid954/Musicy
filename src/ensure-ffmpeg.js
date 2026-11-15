// npm 11+/12 can block install scripts ("allowScripts"), so ffmpeg-static may be installed WITHOUT its binary.
// If the binary is missing, run the package's own download script once (needs internet). Returns true when present.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function ensureFfmpeg({ existsSync = fs.existsSync, run = spawnSync, resolvePath = () => require('ffmpeg-static'), resolveDir = () => path.dirname(require.resolve('ffmpeg-static/package.json')), log = () => {} } = {}) {
  let binary;
  try { binary = resolvePath(); } catch { return false; }
  if (!binary) return false;
  if (existsSync(binary)) return true;
  try {
    const dir = resolveDir();
    log(`ffmpeg binary missing; running ffmpeg-static's download script in ${dir}`);
    run(process.execPath, ['install.js'], { cwd: dir, stdio: 'inherit', timeout: 180_000 });
  } catch (error) {
    log(`ffmpeg download failed: ${error.message}`);
  }
  return existsSync(binary);
}

module.exports = { ensureFfmpeg };

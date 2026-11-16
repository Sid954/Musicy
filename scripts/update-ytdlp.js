// Downloads/updates the standalone yt-dlp binary into ./bin.
const fs = require('node:fs/promises');
const path = require('node:path');
const https = require('node:https');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const log = require('../src/log');
const execFileAsync = promisify(execFile);

const binDir = path.join(__dirname, '..', 'bin');
const isWin = process.platform === 'win32';
const asset = isWin ? 'yt-dlp.exe' : process.platform === 'darwin' ? 'yt-dlp_macos' : process.arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux';
const dest = path.join(binDir, isWin ? 'yt-dlp.exe' : 'yt-dlp');
const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`;
const MIN_BYTES = 5 * 1024 * 1024;

function download(u, out, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('too many redirects'));
    https.get(u, { headers: { 'User-Agent': 'Musicy' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(download(res.headers.location, out, redirects + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const file = require('node:fs').createWriteStream(out);
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    }).on('error', reject);
  });
}

async function validateBinary(filePath, { stat = fs.stat, runVersion = (file) => execFileAsync(file, ['--version'], { timeout: 5000, windowsHide: true, env: require('../src/ytdlp-env').ytdlpEnv() }) } = {}) {
  const info = await stat(filePath);
  if (info.size <= MIN_BYTES) throw new Error(`download is too small (${info.size} bytes)`);
  const result = await runVersion(filePath);
  const version = String(result.stdout || '').trim();
  if (!version) throw new Error('yt-dlp --version returned no version');
  return version;
}

async function replaceBinary(tempPath, destPath, { rename = fs.rename, remove = fs.rm } = {}) {
  const backup = `${destPath}.bak`;
  let hadCurrent = false;
  await remove(backup, { force: true }).catch(() => {});
  try { await rename(destPath, backup); hadCurrent = true; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  try {
    await rename(tempPath, destPath);
    if (!isWin) await fs.chmod(destPath, 0o755);
  } catch (error) {
    if (hadCurrent) await rename(backup, destPath).catch(() => {});
    throw error;
  }
  // Keep the previous executable as .bak for recovery; remove stale temp only.
  await remove(tempPath, { force: true }).catch(() => {});
  return backup;
}

async function update({ downloadFn = download, destPath = dest, validate = validateBinary } = {}) {
  const tempPath = `${destPath}.${process.pid}.download`;
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await fs.rm(tempPath, { force: true });
  try {
    await downloadFn(url, tempPath);
    if (!isWin) await fs.chmod(tempPath, 0o755);
    const version = await validate(tempPath);
    await replaceBinary(tempPath, destPath);
    log.info(`[yt-dlp] updated to ${version}: ${destPath}`);
    return version;
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

module.exports = { update, dest, download, validateBinary, replaceBinary, MIN_BYTES };

if (require.main === module) {
  update().catch((error) => { log.error('[yt-dlp] update failed:', error.message); process.exit(1); });
}

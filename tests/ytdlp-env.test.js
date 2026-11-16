const test = require('node:test');
const assert = require('node:assert/strict');
const { ytdlpEnv, sweepTmp } = require('../src/ytdlp-env');
const { classifyYtdlpError } = require('../src/music/sources/youtube');

test('yt-dlp gets its own temp folder on Linux/macOS and the normal one on Windows', () => {
  const base = { PATH: '/bin', TMPDIR: '/tmp' };
  const linux = ytdlpEnv(base, { platform: 'linux', dir: '/app/data/tmp' });
  assert.deepEqual([linux.TMPDIR, linux.TEMP, linux.TMP, linux.PATH], ['/app/data/tmp', '/app/data/tmp', '/app/data/tmp', '/bin']);
  assert.equal(base.TMPDIR, '/tmp', 'the original environment is not modified');
  assert.equal(ytdlpEnv(base, { platform: 'win32' }), base);
});

test('sweepTmp removes only old _MEI unpack folders', () => {
  const removed = [];
  const now = 1_000_000_000;
  const ages = { _MEI111: 20 * 60_000, _MEI222: 60_000, other: 99 * 60_000 };
  const count = sweepTmp({
    dir: '/t', now, readdir: () => Object.keys(ages), stat: (p) => ({ mtimeMs: now - ages[require('node:path').basename(p)] }),
    remove: (p) => removed.push(require('node:path').basename(p)),
  });
  assert.equal(count, 1);
  assert.deepEqual(removed, ['_MEI111']);
  assert.equal(sweepTmp({ dir: '/missing', readdir: () => { throw new Error('ENOENT'); } }), 0);
});

test('PyInstaller unpack failures are reported as a host resource problem, not a YouTube problem', () => {
  const stderr = '[PYI-65:ERROR] Failed to extract Cryptodome/Cipher/_ARC4.abi3.so: decompression resulted in return code -1!';
  assert.equal(classifyYtdlpError(stderr).code, 'HOST_RESOURCES');
  assert.match(classifyYtdlpError(stderr).message, /ran out of memory or disk/);
  assert.equal(classifyYtdlpError('ERROR: Sign in to confirm you are not a bot').code, 'BOT_CHECK');
});

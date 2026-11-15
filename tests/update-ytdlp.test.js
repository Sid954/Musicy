const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { validateBinary, replaceBinary, MIN_BYTES } = require('../scripts/update-ytdlp');

test('updater validates download size and executable version before replacement', async () => {
  await assert.rejects(validateBinary('ignored', { stat: async () => ({ size: MIN_BYTES }), runVersion: async () => ({ stdout: '2025.01' }) }), /too small/);
  await assert.rejects(validateBinary('ignored', { stat: async () => ({ size: MIN_BYTES + 1 }), runVersion: async () => ({ stdout: '' }) }), /no version/);
  assert.equal(await validateBinary('ignored', { stat: async () => ({ size: MIN_BYTES + 1 }), runVersion: async () => ({ stdout: '2025.02\n' }) }), '2025.02');
});

test('failed binary swap restores existing executable', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'musicy-ytdlp-'));
  try {
    const dest = path.join(dir, 'yt-dlp');
    const temp = path.join(dir, 'download');
    await fs.writeFile(dest, 'old');
    await fs.writeFile(temp, 'new');
    let renames = 0;
    const rename = async (from, to) => {
      renames++;
      if (renames === 2) throw new Error('swap failed');
      return fs.rename(from, to);
    };
    await assert.rejects(replaceBinary(temp, dest, { rename, remove: fs.rm }), /swap failed/);
    assert.equal(await fs.readFile(dest, 'utf8'), 'old');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

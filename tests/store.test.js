const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createStore, DEFAULTS } = require('../src/store');

async function withTempStore(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'musicy-store-'));
  try {
    await fn({ dir, filePath: path.join(dir, 'settings.json') });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('store returns defaults, merges patches, and persists settings across reloads', async () => {
  await withTempStore(async ({ filePath }) => {
    const store = createStore({ filePath, debounceMs: 60_000 });
    await store.load();
    assert.deepEqual(store.get('guild-1'), DEFAULTS);

    const updated = store.set('guild-1', { volume: 140, djRole: 'role-1' });
    assert.deepEqual(updated, { ...DEFAULTS, volume: 140, djRole: 'role-1' });
    assert.deepEqual(store.set('guild-1', { autoplay: true }), {
      ...DEFAULTS, volume: 140, djRole: 'role-1', autoplay: true,
    });

    await store.flush();
    const reloaded = createStore({ filePath });
    await reloaded.load();
    assert.deepEqual(reloaded.get('guild-1'), {
      ...DEFAULTS, volume: 140, djRole: 'role-1', autoplay: true,
    });
    assert.deepEqual(reloaded.get('guild-2'), DEFAULTS);
  });
});

test('store debounces writes and writes atomically', async () => {
  await withTempStore(async ({ filePath }) => {
    const store = createStore({ filePath, debounceMs: 25 });
    await store.load();
    store.set('guild-1', { volume: 120 });
    await assert.rejects(fs.access(filePath), { code: 'ENOENT' });
    let saved;
    const deadline = Date.now() + 2000;
    while (!saved && Date.now() < deadline) {
      try {
        saved = JSON.parse(await fs.readFile(filePath, 'utf8'));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    assert.ok(saved, 'debounced settings write should finish within 2 seconds');
    assert.equal(saved['guild-1'].volume, 120);
    assert.deepEqual((await fs.readdir(path.dirname(filePath))).sort(), ['settings.json']);
  });
});

test('store backs up corrupt settings and starts empty', async () => {
  await withTempStore(async ({ filePath }) => {
    await fs.writeFile(filePath, '{broken json', 'utf8');
    const store = createStore({ filePath });
    await store.load();
    assert.deepEqual(store.get('guild-1'), DEFAULTS);
    assert.equal(await fs.readFile(`${filePath}.bad`, 'utf8'), '{broken json');
    await assert.rejects(fs.access(filePath), { code: 'ENOENT' });
  });
});

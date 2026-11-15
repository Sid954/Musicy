const test = require('node:test');
const assert = require('node:assert/strict');
const { flushStoresWithTimeout } = require('../src/music/shutdown');

test('shutdown helper flushes every store, including queue facade', async () => {
  const calls = [];
  const stores = ['settings', 'playlists'].map((name) => ({ flush: async () => calls.push(name) }));
  stores.push({ flushQueues: async () => calls.push('queues') });
  const result = await flushStoresWithTimeout(stores, 500);
  assert.equal(result.timedOut, false);
  assert.deepEqual(calls.sort(), ['playlists', 'queues', 'settings']);
});

test('shutdown helper returns after its flush timeout', async () => {
  const result = await flushStoresWithTimeout([{ flush: () => new Promise(() => {}) }], 5);
  assert.deepEqual(result, { timedOut: true });
});

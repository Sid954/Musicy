const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldUpdateProgress, createLiveProgressUpdater, DEFAULT_INTERVAL_MS } = require('../src/music/live-progress');

test('progress updates only for playing finite tracks with listeners', () => {
  assert.equal(shouldUpdateProgress({ eligible: true, paused: false, listeners: 1 }), true);
  assert.equal(shouldUpdateProgress({ eligible: true, paused: true, listeners: 1 }), false);
  assert.equal(shouldUpdateProgress({ eligible: true, paused: false, listeners: 0 }), false);
  assert.equal(shouldUpdateProgress({ eligible: false, paused: false, listeners: 3 }), false);
  assert.equal(DEFAULT_INTERVAL_MS, 15_000);
});

test('updater uses one timer, waits when paused/no listeners, resumes, and stops on edit error', async () => {
  const queue = [];
  const canceled = [];
  const setTimer = (fn, delay) => { const handle = { fn, delay }; queue.push(handle); return handle; };
  const clearTimer = (handle) => canceled.push(handle);
  let eligible = true;
  let paused = false;
  let listeners = 0;
  let edits = 0;
  const errors = [];
  const updater = createLiveProgressUpdater({
    intervalMs: 15_000, setTimer, clearTimer,
    isEligible: () => eligible, isPaused: () => paused, getListeners: () => listeners,
    onTick: async () => { edits++; throw new Error('deleted message'); },
    onError: (error) => errors.push(error.message),
  });
  updater.start();
  updater.start();
  assert.equal(queue.length, 1);
  assert.equal(queue[0].delay, 15_000);
  const noListenerTick = queue.shift();
  await noListenerTick.fn();
  assert.equal(edits, 0);
  assert.equal(queue.length, 1);
  listeners = 1;
  const listenerTick = queue.shift();
  await listenerTick.fn();
  assert.equal(edits, 1);
  assert.equal(updater.active, false);
  assert.deepEqual(errors, ['deleted message']);
  updater.stop();
  assert.equal(queue.length, 0);
  paused = true;
  eligible = false;
  assert.equal(canceled.length, 0);
});

test('stop cancels the one pending timer', () => {
  const queue = [];
  const canceled = [];
  const updater = createLiveProgressUpdater({
    setTimer: (fn) => { const handle = { fn }; queue.push(handle); return handle; },
    clearTimer: (handle) => canceled.push(handle),
    isEligible: () => true, isPaused: () => false, getListeners: () => 1, onTick: async () => true,
  });
  updater.start();
  const pending = queue[0];
  updater.stop();
  assert.deepEqual(canceled, [pending]);
  assert.equal(updater.pending, false);
});

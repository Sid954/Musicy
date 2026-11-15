const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateMemory, createMemoryWatchdog } = require('../src/memory-watchdog');

test('memory thresholds warn at configured max and exit above 480 MB', () => {
  assert.deepEqual(evaluateMemory(419 * 1024 * 1024, 420), { rssMb: 419, warn: false, exit: false });
  assert.deepEqual(evaluateMemory(421 * 1024 * 1024, 420), { rssMb: 421, warn: true, exit: false });
  assert.deepEqual(evaluateMemory(481 * 1024 * 1024, 420), { rssMb: 481, warn: true, exit: true });
});

test('watchdog clears caches, runs available GC, and requests nonzero exit above hard cap', () => {
  const calls = [];
  const watchdog = createMemoryWatchdog({
    getMemoryUsage: () => ({ rss: 481 * 1024 * 1024 }),
    clearCaches: () => calls.push('clear'), gc: () => calls.push('gc'), exit: (code) => calls.push(`exit:${code}`),
    logger: { warn: () => calls.push('warn'), error: () => calls.push('error') },
  });
  assert.equal(watchdog.check().exit, true);
  assert.deepEqual(calls, ['warn', 'clear', 'gc', 'error', 'exit:1']);
});

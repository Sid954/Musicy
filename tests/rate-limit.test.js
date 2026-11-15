const test = require('node:test');
const assert = require('node:assert/strict');
const { createCooldown, createConcurrencyLimiter } = require('../src/music/rate-limit');

test('cooldown is per key and reports remaining time', () => {
  let now = 1000;
  const cooldown = createCooldown({ durationMs: 3000, now: () => now });
  assert.equal(cooldown.check('user-a:play').allowed, true);
  assert.deepEqual(cooldown.check('user-a:play'), { allowed: false, retryAfterMs: 3000 });
  assert.equal(cooldown.check('user-a:search').allowed, true);
  now += 3000;
  assert.equal(cooldown.check('user-a:play').allowed, true);
});

test('a woken waiter rechecks capacity when a new task wins the scheduling race', async () => {
  const limit = createConcurrencyLimiter(1);
  let releaseFirst;
  let active = 0;
  let peak = 0;
  const first = limit(async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => { releaseFirst = resolve; });
    active--;
  });
  let markSecondStarted;
  const secondStarted = new Promise((resolve) => { markSecondStarted = resolve; });
  const second = limit(async () => {
    active++;
    peak = Math.max(peak, active);
    markSecondStarted();
    active--;
  });
  releaseFirst();
  const third = Promise.resolve().then(() => limit(async () => {
    active++;
    peak = Math.max(peak, active);
    active--;
  }));
  await Promise.all([first, second, third, secondStarted]);
  assert.equal(peak, 1);
});

test('concurrency limiter never runs more than its configured task count', async () => {
  const limit = createConcurrencyLimiter(2);
  let active = 0;
  let peak = 0;
  const jobs = Array.from({ length: 6 }, () => limit(async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
  }));
  await Promise.all(jobs);
  assert.equal(peak, 2);
});

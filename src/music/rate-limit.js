function createConcurrencyLimiter(limit = 2) {
  let active = 0;
  const waiting = [];
  return async function run(task) {
    while (active >= limit) await new Promise((resolve) => waiting.push(resolve));
    active++;
    try { return await task(); }
    finally { active--; waiting.shift()?.(); }
  };
}

function createCooldown({ durationMs = 3000, now = Date.now, maxEntries = 10_000 } = {}) {
  const lastUse = new Map();
  return {
    check(key) {
      const current = now();
      const previous = lastUse.get(String(key));
      if (previous !== undefined && current - previous < durationMs) return { allowed: false, retryAfterMs: durationMs - (current - previous) };
      lastUse.delete(String(key));
      lastUse.set(String(key), current);
      while (lastUse.size > maxEntries) lastUse.delete(lastUse.keys().next().value);
      return { allowed: true, retryAfterMs: 0 };
    },
    clear() { lastUse.clear(); },
  };
}

module.exports = { createConcurrencyLimiter, createCooldown };

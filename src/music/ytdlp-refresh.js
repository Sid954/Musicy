const COOLDOWN_MS = 60 * 60 * 1000;

function createYtdlpRefresher({ now = Date.now, cooldownMs = COOLDOWN_MS } = {}) {
  let lastAttempt = -Infinity;
  let inFlight = null;
  return async function refresh(update) {
    if (inFlight) return inFlight;
    if (now() - lastAttempt < cooldownMs) return false;
    lastAttempt = now();
    inFlight = Promise.resolve().then(update).then(() => true).finally(() => { inFlight = null; });
    return inFlight;
  };
}

module.exports = { createYtdlpRefresher, COOLDOWN_MS };

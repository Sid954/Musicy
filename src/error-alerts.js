// Tells the bot owner (by DM) when the same error keeps happening, so a broken host does not go unnoticed.
// A single stray error is normal; N of the same kind within a window is worth interrupting for.
const WINDOW_MS = 10 * 60_000;
const COOLDOWN_MS = 30 * 60_000;

// Same problem, different details (ids, numbers, quoted names) -> same key.
function errorKey(text) {
  return String(text || '')
    .split('\n')[0]
    .replace(/\d+/g, '#')
    .replace(/["'`][^"'`]*["'`]/g, '"…"')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}

function createErrorAlerts({ send, threshold = 3, totalThreshold = 10, windowMs = WINDOW_MS, cooldownMs = COOLDOWN_MS, now = Date.now } = {}) {
  const seen = new Map(); // key -> timestamps within the window
  const lastAlert = new Map(); // key (or "*") -> last alert time
  let all = [];

  const quiet = (key, at) => lastAlert.has(key) && at - lastAlert.get(key) < cooldownMs;
  const deliver = (key, at, text) => { lastAlert.set(key, at); Promise.resolve().then(() => send(text)).catch(() => {}); };

  // `entry`: { line } as given to log listeners.
  function record(entry) {
    const at = now();
    const text = String(typeof entry === 'string' ? entry : entry?.line ?? '');
    const summary = text.replace(/^\S+\s+ERROR\s+/, '');
    const key = errorKey(summary);
    if (!key) return false;

    const times = (seen.get(key) || []).filter((t) => at - t < windowMs);
    times.push(at);
    seen.set(key, times);
    all = all.filter((t) => at - t < windowMs);
    all.push(at);
    if (seen.size > 200) seen.delete(seen.keys().next().value); // bounded memory

    if (times.length >= threshold && !quiet(key, at)) {
      deliver(key, at, `⚠️ **The same error happened ${times.length}× in ${Math.round(windowMs / 60_000)} minutes**\n\`\`\`\n${summary.slice(0, 700)}\n\`\`\`Check \`/admin logs\` or run \`/admin selftest\`.`);
      return true;
    }
    if (all.length >= totalThreshold && !quiet('*', at)) {
      deliver('*', at, `⚠️ **${all.length} errors in ${Math.round(windowMs / 60_000)} minutes** (different kinds). Latest:\n\`\`\`\n${summary.slice(0, 700)}\n\`\`\`Check \`/admin logs\`.`);
      return true;
    }
    return false;
  }

  return { record };
}

// Sends `text` to each owner by DM; closed DMs or unknown users are ignored.
function createOwnerDm(client, ownerIds) {
  return async (text) => {
    for (const id of ownerIds) {
      try { await (await client.users.fetch(id)).send(text); } catch { /* DMs closed */ }
    }
  };
}

module.exports = { WINDOW_MS, COOLDOWN_MS, errorKey, createErrorAlerts, createOwnerDm };

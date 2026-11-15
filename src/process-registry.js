// Every yt-dlp / ffmpeg the bot launches is registered here so none can outlive the bot or leak forever:
//   - killAll() runs on exit/shutdown (Windows does not kill children when the parent dies),
//   - sweep() kills anything older than its allowed age (a lost reference would otherwise leak for good).
const { spawnSync } = require('node:child_process');

const DEFAULT_MAX_AGE_MS = 13 * 60 * 60 * 1000; // longer than any allowed track (max-duration setting is <= 12 h)

// Windows: /T also ends the worker that yt-dlp's single-file launcher spawns. Elsewhere SIGKILL is enough.
function defaultKill(child) {
  try {
    if (process.platform === 'win32' && child.pid) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else child.kill('SIGKILL');
  } catch { /* already gone */ }
}

function createRegistry({ kill = defaultKill, now = Date.now } = {}) {
  const tracked = new Map(); // pid -> { child, label, startedAt, maxAgeMs }

  function track(child, { label = 'helper', maxAgeMs = DEFAULT_MAX_AGE_MS } = {}) {
    if (!child || !child.pid) return child;
    const pid = child.pid;
    tracked.set(pid, { child, label, startedAt: now(), maxAgeMs });
    const forget = () => { tracked.delete(pid); };
    child.once('close', forget);
    child.once('exit', forget);
    child.once('error', forget);
    return child;
  }

  function killAll() {
    const entries = [...tracked.values()];
    tracked.clear();
    for (const entry of entries) kill(entry.child);
    return entries.length;
  }

  // Kills every process past its maximum age. Returns what was killed (for logging).
  function sweep(at = now()) {
    const killed = [];
    for (const [pid, entry] of [...tracked]) {
      if (at - entry.startedAt > entry.maxAgeMs) {
        tracked.delete(pid);
        kill(entry.child);
        killed.push({ pid, label: entry.label, ageMs: at - entry.startedAt });
      }
    }
    return killed;
  }

  const snapshot = (at = now()) => [...tracked].map(([pid, entry]) => ({ pid, label: entry.label, ageMs: at - entry.startedAt }));

  return { track, killAll, sweep, snapshot, count: () => tracked.size };
}

const registry = createRegistry();
module.exports = { DEFAULT_MAX_AGE_MS, createRegistry, ...registry };

// One live (synced) lyrics message per guild. Edits at most once per interval and stops on track change,
// queue end, pause-free timeout or any edit failure.
const { currentLineIndex, buildLiveLyricsEmbed } = require('./lrc');
const log = require('../log');

const MIN_INTERVAL_MS = 5000;
const DEFAULT_MAX_MS = 14 * 60_000; // stay inside the interaction-token / sanity window
const active = new Map();

function stopLiveLyrics(guildId, reason = 'stopped') {
  active.get(guildId)?.stop(reason);
}

function startLiveLyrics({
  guildId, getQueue, track, lines, message, title,
  intervalMs = MIN_INTERVAL_MS, maxMs = DEFAULT_MAX_MS,
  schedule = setTimeout, cancel = clearTimeout, now = Date.now,
}) {
  stopLiveLyrics(guildId, 'replaced');
  const interval = Math.max(MIN_INTERVAL_MS, intervalMs);
  const startedAt = now();
  let timer = null;
  let stopped = false;
  let lastIndex = null;
  let editing = false;

  const controller = {
    get stopped() { return stopped; },
    stop(reason = 'stopped') {
      if (stopped) return;
      stopped = true;
      cancel(timer);
      if (active.get(guildId) === controller) active.delete(guildId);
      if (reason !== 'replaced') {
        Promise.resolve().then(() => message.edit({ embeds: [buildLiveLyricsEmbed({ title, lines, index: lastIndex ?? -1, ended: true })] })).catch(() => {});
      }
    },
    tick,
  };

  async function tick() {
    if (stopped) return;
    const queue = getQueue();
    if (!queue || queue.current !== track || now() - startedAt > maxMs) return controller.stop('ended');
    if (queue.player?.state?.status !== 'paused') {
      const index = currentLineIndex(lines, queue.getElapsedSeconds());
      if (index !== lastIndex && !editing) {
        editing = true;
        try {
          await message.edit({ embeds: [buildLiveLyricsEmbed({ title, lines, index })] });
          lastIndex = index;
        } catch (error) {
          log.warn('Stopping live lyrics:', error.message);
          editing = false;
          stopped = true;
          if (active.get(guildId) === controller) active.delete(guildId);
          return;
        }
        editing = false;
      }
    }
    if (!stopped) {
      timer = schedule(tick, interval);
      timer?.unref?.();
    }
  }

  active.set(guildId, controller);
  tick();
  return controller;
}

module.exports = { MIN_INTERVAL_MS, startLiveLyrics, stopLiveLyrics, activeCount: () => active.size };

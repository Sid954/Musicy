const log = require('./log');

function evaluateMemory(rssBytes, maxRssMb = 420) {
  const rssMb = rssBytes / (1024 * 1024);
  return { rssMb, warn: rssMb > maxRssMb, exit: rssMb > 480 };
}

function createMemoryWatchdog({
  getMemoryUsage = process.memoryUsage,
  maxRssMb = Number.parseInt(process.env.MAX_RSS_MB, 10) || 420,
  clearCaches = () => {},
  gc = global.gc,
  exit = (code) => process.exit(code),
  logger = log,
  intervalMs = 60_000,
} = {}) {
  let timer = null;
  function check() {
    const { rssMb, warn, exit: shouldExit } = evaluateMemory(getMemoryUsage().rss, maxRssMb);
    if (warn) {
      logger.warn(`Memory watchdog: RSS ${Math.round(rssMb)} MB exceeds ${maxRssMb} MB; clearing caches.`);
      clearCaches();
      if (typeof gc === 'function') gc();
    }
    if (shouldExit) {
      logger.error(`Memory watchdog: RSS ${Math.round(rssMb)} MB exceeds 480 MB; exiting for restart.`);
      exit(1);
    }
    return { rssMb, warn, exit: shouldExit };
  }
  function start() {
    if (timer) return;
    timer = setInterval(check, intervalMs);
    timer.unref?.();
  }
  function stop() { clearInterval(timer); timer = null; }
  return { check, start, stop };
}

module.exports = { evaluateMemory, createMemoryWatchdog };

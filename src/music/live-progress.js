const DEFAULT_INTERVAL_MS = 15_000;

function shouldUpdateProgress({ eligible, paused, listeners }) {
  return Boolean(eligible && !paused && listeners > 0);
}

function createLiveProgressUpdater({
  intervalMs = DEFAULT_INTERVAL_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  isEligible,
  getListeners,
  isPaused,
  onTick,
  onError = () => {},
}) {
  let timer = null;
  let stopped = true;
  let running = false;

  function stop() {
    stopped = true;
    if (timer) clearTimer(timer);
    timer = null;
  }

  function schedule() {
    if (stopped || timer || running) return;
    timer = setTimer(async () => {
      timer = null;
      if (stopped) return;
      if (!shouldUpdateProgress({
        eligible: isEligible(),
        paused: isPaused(),
        listeners: getListeners(),
      })) return schedule();
      running = true;
      try {
        const keepGoing = await onTick();
        if (keepGoing === false) stop();
      } catch (error) {
        stop();
        onError(error);
      } finally {
        running = false;
        schedule();
      }
    }, intervalMs);
    timer?.unref?.();
  }

  function start() {
    if (!stopped) return;
    stopped = false;
    schedule();
  }

  return { start, stop, get active() { return !stopped; }, get pending() { return Boolean(timer); } };
}

module.exports = { DEFAULT_INTERVAL_MS, shouldUpdateProgress, createLiveProgressUpdater };

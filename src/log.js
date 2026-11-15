const LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40 });
const configured = String(process.env.LOG_LEVEL || 'info').toLowerCase();
const threshold = LEVELS[configured] ?? LEVELS.info;
const listeners = [];

function serialize(value) {
  if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

function log(level, ...values) {
  if (LEVELS[level] < threshold) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${values.map(serialize).join(' ')}`;
  (level === 'error' ? process.stderr : process.stdout).write(`${line}\n`);
  // File logging and owner alerts subscribe here. A broken listener must never break the bot.
  for (const listener of listeners) {
    try { listener({ level, line, values }); } catch { /* ignore */ }
  }
}

module.exports = {
  debug: (...values) => log('debug', ...values),
  info: (...values) => log('info', ...values),
  warn: (...values) => log('warn', ...values),
  error: (...values) => log('error', ...values),
  addListener: (listener) => { listeners.push(listener); return () => { const at = listeners.indexOf(listener); if (at >= 0) listeners.splice(at, 1); }; },
};

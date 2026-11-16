// Pure: turns the cookies configuration + YouTube bot-check history into a readable status and a hint.
const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_AFTER_DAYS = 30;

function ago(ms) {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

function parseOwnerIds(value) {
  return String(value || '').split(/[\s,]+/).filter((id) => /^\d{5,25}$/.test(id));
}

// state: { configured, exists, mtimeMs, lastBotCheckAt, botCheckCount }
function describeCookies({ configured = false, exists = false, mtimeMs = 0, lastBotCheckAt = 0, botCheckCount = 0, lastOkAt = 0 } = {}, now = Date.now()) {
  const lines = [];
  let hint;
  const botChecks = botCheckCount > 0;

  if (!configured) {
    lines.push('**Cookies:** not configured (`YTDLP_COOKIES` is empty)');
  } else if (!exists) {
    lines.push('**Cookies:** configured, but the file was **not found**');
    hint = 'Check the `YTDLP_COOKIES` path (relative paths start in the project folder) and restart the bot.';
  } else {
    const ageDays = Math.floor((now - mtimeMs) / DAY_MS);
    lines.push(`**Cookies:** file found · last modified ${ago(now - mtimeMs)}`);
    if (ageDays >= STALE_AFTER_DAYS) hint = `The cookie file is ${ageDays} days old. Cookies expire; export a fresh \`cookies.txt\` if YouTube starts refusing.`;
  }

  lines.push(botChecks
    ? `**YouTube sign-in requests:** ${botCheckCount} since start · last ${ago(now - lastBotCheckAt)}`
    : '**YouTube sign-in requests:** none since the bot started ✅');

  if (botChecks && configured && exists && lastOkAt > lastBotCheckAt) {
    // yt-dlp rewrites cookies.txt after every run, so the file time is not a reliable "saved" marker: trust the lookups.
    lines.push(`**Last successful lookup:** ${ago(now - lastOkAt)}`);
    hint = 'Cookies look **fine now**: the last lookup worked after the last sign-in request. Earlier requests were probably from before the cookies were loaded. If songs keep failing, re-export fresh cookies.';
  } else if (botChecks && !configured) {
    hint = 'YouTube is blocking this host. Export cookies from a throwaway YouTube account (Netscape `cookies.txt`), set `YTDLP_COOKIES`, and restart.';
  } else if (botChecks && configured && exists && lastBotCheckAt > mtimeMs) {
    hint = 'YouTube still asked to sign in after the cookies were saved. Re-export fresh cookies (log in again, export, replace the file, restart).';
  }
  return { lines, hint };
}

module.exports = { STALE_AFTER_DAYS, ago, parseOwnerIds, describeCookies };

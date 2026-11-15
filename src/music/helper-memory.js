// Memory used by the helper programs the bot launches (yt-dlp, ffmpeg). The host's RAM limit counts them,
// but process.memoryUsage() only sees Node. Matching by program name also catches leaked/orphaned processes
// and the real worker behind yt-dlp's single-file launcher.
const fs = require('node:fs/promises');
const { execFile } = require('node:child_process');

const HELPER_PATTERN = /^(yt-dlp|ffmpeg)/i;
const MAX_PROC_ENTRIES = 1000;

const baseName = (value) => String(value || '').split(/[\\/]/).pop().replace(/\.exe$/i, '');

// Windows: tasklist /FO CSV /NH  ->  "image","pid","session","session#","12,345 K"
function parseTasklistCsv(text) {
  const entries = [];
  for (const line of String(text).split(/\r?\n/)) {
    const match = line.match(/^"([^"]+)","(\d+)","[^"]*","[^"]*","([^"]*)"/);
    if (!match) continue;
    const kb = Number(match[3].replace(/[^\d]/g, ''));
    if (Number.isFinite(kb)) entries.push({ name: baseName(match[1]), pid: Number(match[2]), kb });
  }
  return entries;
}

// Linux: /proc/<pid>/status
function parseProcStatus(text, pid) {
  const name = String(text).match(/^Name:\s*(.+)$/m)?.[1]?.trim();
  const kb = Number(String(text).match(/^VmRSS:\s*(\d+)\s*kB/m)?.[1]);
  return name && Number.isFinite(kb) ? { name: baseName(name), pid, kb } : null;
}

// macOS / other unix: ps -axo rss=,comm=
function parsePsOutput(text) {
  const entries = [];
  for (const line of String(text).split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\s+(.+?)\s*$/);
    if (match) entries.push({ name: baseName(match[2]), pid: 0, kb: Number(match[1]) });
  }
  return entries;
}

function groupHelpers(entries) {
  const groups = {};
  let totalKb = 0;
  for (const entry of entries) {
    const key = entry.name.toLowerCase().startsWith('yt-dlp') ? 'yt-dlp' : entry.name.toLowerCase().startsWith('ffmpeg') ? 'ffmpeg' : null;
    if (!key) continue;
    groups[key] = groups[key] || { count: 0, kb: 0 };
    groups[key].count += 1;
    groups[key].kb += entry.kb;
    totalKb += entry.kb;
  }
  const out = {};
  for (const [key, value] of Object.entries(groups)) out[key] = { count: value.count, mb: Math.round(value.kb / 1024) };
  return { groups: out, totalMb: Math.round(totalKb / 1024) };
}

const run = (file, args) => new Promise((resolve, reject) => {
  execFile(file, args, { timeout: 4000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => (error ? reject(error) : resolve(String(stdout))));
});

// Dependencies are injectable so each platform branch can be tested anywhere.
async function readHelperProcesses({ platform = process.platform, exec = run, readdir = fs.readdir, readFile = fs.readFile } = {}) {
  if (platform === 'win32') {
    return parseTasklistCsv(await exec('tasklist', ['/FO', 'CSV', '/NH'])).filter((e) => HELPER_PATTERN.test(e.name));
  }
  if (platform === 'linux') {
    const pids = (await readdir('/proc')).filter((name) => /^\d+$/.test(name)).slice(0, MAX_PROC_ENTRIES);
    const entries = [];
    for (const pid of pids) {
      try {
        const entry = parseProcStatus(await readFile(`/proc/${pid}/status`, 'utf8'), Number(pid));
        if (entry && HELPER_PATTERN.test(entry.name)) entries.push(entry);
      } catch { /* process exited while we looked */ }
    }
    return entries;
  }
  return parsePsOutput(await exec('ps', ['-axo', 'rss=,comm='])).filter((e) => HELPER_PATTERN.test(e.name));
}

function formatHelpers(groups) {
  const parts = Object.entries(groups).map(([name, { count, mb }]) => `${name} ${count}× ${mb} MB`);
  return parts.length ? parts.join(' · ') : 'none running';
}

// One-line verdict against the host limit (defaults to the 512 MB free tier).
function describeTotal({ nodeMb, helpersMb, limitMb = 512 }) {
  const total = nodeMb + helpersMb;
  const percent = Math.round((total / limitMb) * 100);
  const flag = percent >= 85 ? '⚠️' : percent >= 70 ? '🟡' : '✅';
  return `${flag} Total ≈ ${total} MB of ${limitMb} MB (${percent}%)`;
}

module.exports = {
  parseTasklistCsv, parseProcStatus, parsePsOutput, groupHelpers, readHelperProcesses, formatHelpers, describeTotal, HELPER_PATTERN,
};

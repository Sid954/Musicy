// Pure LRC (synced lyrics) parsing + the live-lyrics embed.
const { EmbedBuilder } = require('discord.js');
const { clip } = require('./pager');

const TAG = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

function fraction(digits) {
  if (!digits) return 0;
  const n = Number(digits);
  return digits.length >= 3 ? n / 1000 : digits.length === 2 ? n / 100 : n / 10;
}

// "[00:12.50][01:20.00] text" -> [{ time: 12.5, text }, { time: 80, text }], sorted by time.
function parseLrc(source) {
  const lines = [];
  let offsetMs = 0;
  for (const raw of String(source || '').split(/\r?\n/)) {
    const offset = raw.match(/^\s*\[offset:\s*([+-]?\d+)\s*\]/i);
    if (offset) { offsetMs = Number(offset[1]); continue; }
    const stamps = [...raw.matchAll(TAG)];
    if (!stamps.length) continue;
    const text = raw.replace(TAG, '').trim();
    for (const stamp of stamps) {
      lines.push({ time: Number(stamp[1]) * 60 + Number(stamp[2]) + fraction(stamp[3]), text });
    }
  }
  const shift = offsetMs / 1000; // LRC offset: positive = lyrics appear earlier
  return lines.map((line) => ({ ...line, time: Math.max(0, line.time - shift) })).sort((a, b) => a.time - b.time);
}

// Index of the last line that has started at `elapsed` (-1 before the first line).
function currentLineIndex(lines, elapsed) {
  let low = 0;
  let high = lines.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lines[mid].time <= elapsed) { found = mid; low = mid + 1; } else high = mid - 1;
  }
  return found;
}

const show = (line) => (line?.text ? clip(line.text, 120) : '♪');

function buildLiveLyricsEmbed({ title, lines, index, ended = false }) {
  const embed = new EmbedBuilder().setColor(ended ? 0x747f8d : 0xeb459e).setTitle(`🎤 ${clip(title, 240)}`);
  if (ended) return embed.setDescription('*Lyrics ended.*');
  if (!lines.length) return embed.setDescription('*No synced lyrics.*');
  const previous = index > 0 ? `-# ${show(lines[index - 1])}\n` : '';
  const current = index >= 0 ? `**${show(lines[index])}**` : '*♪ …*';
  const upcoming = [lines[index + 1], lines[index + 2]].filter(Boolean).map((line) => `-# ${show(line)}`).join('\n');
  return embed.setDescription(clip(`${previous}${current}${upcoming ? `\n${upcoming}` : ''}`, 4096));
}

module.exports = { parseLrc, currentLineIndex, buildLiveLyricsEmbed };

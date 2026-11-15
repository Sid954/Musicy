const test = require('node:test');
const assert = require('node:assert/strict');
const { formatUptime, memoryMb, buildStats } = require('../src/music/stats');

test('stats format uptime, memory, and runtime versions', () => {
  assert.equal(formatUptime(93784), '1d 2h 3m 4s');
  assert.equal(memoryMb(2 * 1024 * 1024), 2);
  const output = buildStats({ uptime: 4, memory: { rss: 1024 * 1024, heapUsed: 512 * 1024, heapTotal: 2 * 1024 * 1024 }, guildCount: 3, activeConnections: 1, ytdlpVersion: '2025.01', nodeVersion: 'v20', discordVersion: '14', voiceVersion: '0.19' });
  assert.match(output, /RSS 1 MB/);
  assert.match(output, /Guilds: 3/);
  assert.match(output, /yt-dlp: 2025.01/);
});

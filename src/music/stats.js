function formatUptime(seconds) {
  const total = Math.floor(seconds || 0);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return `${days}d ${hours}h ${minutes}m ${secs}s`;
}

function memoryMb(bytes) { return Math.round(bytes / (1024 * 1024)); }

function buildStats({ uptime, memory, guildCount, activeConnections, ytdlpVersion, nodeVersion, discordVersion, voiceVersion, helpersLine, totalLine }) {
  return [
    `Uptime: ${formatUptime(uptime)}`,
    `Memory: RSS ${memoryMb(memory.rss)} MB · heap ${memoryMb(memory.heapUsed)}/${memoryMb(memory.heapTotal)} MB`,
    ...(helpersLine ? [`Helpers: ${helpersLine}`] : []),
    ...(totalLine ? [totalLine] : []),
    `Guilds: ${guildCount} · active voice connections: ${activeConnections}`,
    `yt-dlp: ${ytdlpVersion || 'unknown'}`,
    `Node: ${nodeVersion} · discord.js: ${discordVersion} · @discordjs/voice: ${voiceVersion}`,
  ].join('\n');
}

module.exports = { formatUptime, memoryMb, buildStats };

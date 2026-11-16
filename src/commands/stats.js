const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const voice = require('@discordjs/voice');
const discord = require('discord.js');
const embeds = require('../embeds');
const music = require('../music/player');
const { buildStats } = require('../music/stats');
const { dest } = require('../../scripts/update-ytdlp');
const { execFile } = require('node:child_process');
const { readHelperProcesses, groupHelpers, formatHelpers, describeTotal } = require('../music/helper-memory');

let ytdlpVersion = 'not checked';
let versionPromise = null;
function getYtdlpVersion() {
  if (!versionPromise) versionPromise = new Promise((resolve) => {
    execFile(dest, ['--version'], { timeout: 3000, windowsHide: true, env: require('../ytdlp-env').ytdlpEnv() }, (error, stdout) => {
      ytdlpVersion = error ? 'unavailable' : String(stdout).trim().slice(0, 40);
      resolve(ytdlpVersion);
    });
  });
  return versionPromise;
}

module.exports = {
  data: new SlashCommandBuilder().setName('stats').setDescription('Show bot runtime and memory stats'),
  async execute(i) {
    // Reading helper processes can take longer than Discord's 3 s reply window on a busy host: acknowledge first.
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const memory = process.memoryUsage();
    // yt-dlp / ffmpeg count toward the host's RAM limit but are invisible to process.memoryUsage().
    let helpersLine = 'unavailable on this system';
    let totalLine;
    try {
      const { groups, totalMb } = groupHelpers(await readHelperProcesses());
      helpersLine = formatHelpers(groups);
      totalLine = describeTotal({ nodeMb: Math.round(memory.rss / 1048576), helpersMb: totalMb, limitMb: Number(process.env.MEMORY_LIMIT_MB) || 512 });
    } catch { /* keep the fallback text */ }
    const description = buildStats({
      uptime: process.uptime(), memory,
      guildCount: i.client.guilds.cache.size,
      activeConnections: music.activeConnections(),
      helpersLine, totalLine,
      ytdlpVersion: await getYtdlpVersion(),
      nodeVersion: process.version,
      discordVersion: discord.version,
      voiceVersion: voice.version || require(require('node:path').join(require('node:path').dirname(require.resolve('@discordjs/voice')), '..', 'package.json')).version,
    });
    await i.editReply({ embeds: [embeds.info(description)] });
  },
};

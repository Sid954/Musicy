const fs = require('node:fs/promises');
const path = require('node:path');
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const embeds = require('../embeds');
const youtube = require('../music/sources/youtube');
const { describeCookies, parseOwnerIds } = require('../music/cookies-status');
const { getFileLog } = require('../log-file');
const { runSelfTest, summarize } = require('../selftest');
const { formatReport } = require('../startup-check');

async function cookieState() {
  const configured = Boolean(process.env.YTDLP_COOKIES);
  let exists = false;
  let mtimeMs = 0;
  if (configured) {
    try {
      mtimeMs = (await fs.stat(path.resolve(process.env.YTDLP_COOKIES))).mtimeMs;
      exists = true;
    } catch { /* missing file */ }
  }
  return { configured, exists, mtimeMs, ...youtube.getHealth() };
}

// Fits the last lines of the log into one Discord message (code block, newest lines kept).
function fitLog(lines, maxChars = 1850) {
  let text = lines.join('\n');
  if (text.length > maxChars) text = `…${text.slice(text.length - maxChars + 1)}`;
  return text.replace(/```/g, "'''");
}

const subcommands = {
  async cookies(i) {
    const { lines, hint } = describeCookies(await cookieState());
    const embed = new EmbedBuilder().setColor(hint ? 0xfee75c : 0x57f287).setTitle('🍪 YouTube cookies').setDescription(lines.join('\n'));
    if (hint) embed.addFields({ name: 'What to do', value: hint.slice(0, 1024) });
    await i.reply({ embeds: [embed], ephemeral: true });
  },

  async logs(i) {
    const sink = getFileLog();
    if (!sink) return i.reply({ embeds: [embeds.error('File logging is off (`LOG_FILE=off`) or has not started.')], ephemeral: true });
    const lines = await sink.tail(i.options.getInteger('lines') || 20);
    if (!lines.length) return i.reply({ embeds: [embeds.info('The log is empty.')], ephemeral: true });
    await i.reply({ content: `\`\`\`\n${fitLog(lines)}\n\`\`\``, ephemeral: true });
  },

  async selftest(i) {
    await i.deferReply({ ephemeral: true });
    const extra = [{ level: 'ok', name: 'Discord', message: `connected, ping ${Math.round(i.client.ws.ping)} ms, ${i.client.guilds.cache.size} server(s)` }];
    const results = await runSelfTest({ extra, describeError: (error) => String(error.stderr || error.message).trim().split('\n').pop().slice(0, 200) });
    const { errors, warnings } = summarize(results);
    const embed = new EmbedBuilder()
      .setColor(errors ? 0xed4245 : warnings ? 0xfee75c : 0x57f287)
      .setTitle(`${errors ? '❌' : warnings ? '⚠️' : '✅'} Self-test: ${errors} error(s), ${warnings} warning(s)`)
      .setDescription(formatReport(results).slice(0, 4000));
    await i.editReply({ embeds: [embed] });
  },
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Bot owner tools (only the BOT_OWNER_ID user can use them)')
    .addSubcommand((s) => s.setName('cookies').setDescription('Check the YouTube cookies setup and recent sign-in requests'))
    .addSubcommand((s) => s.setName('selftest').setDescription('Check config, yt-dlp, ffmpeg, network and YouTube from the host'))
    .addSubcommand((s) => s.setName('logs').setDescription('Show the latest log lines')
      .addIntegerOption((o) => o.setName('lines').setDescription('How many lines (default 20)').setMinValue(5).setMaxValue(60))),
  async execute(i) {
    const owners = parseOwnerIds(process.env.BOT_OWNER_ID);
    if (!owners.length) {
      return i.reply({ embeds: [embeds.error('Set `BOT_OWNER_ID` in `.env` to your Discord user ID to use owner tools.')], ephemeral: true });
    }
    if (!owners.includes(i.user.id)) {
      return i.reply({ embeds: [embeds.error('Only the bot owner can use this command.')], ephemeral: true });
    }
    return subcommands[i.options.getSubcommand()](i);
  },
  fitLog,
};

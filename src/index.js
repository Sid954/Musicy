require('dotenv').config();
const fs = require('fs');
const { Client, GatewayIntentBits, Options, Events } = require('discord.js');
const commands = require('./commands');
const log = require('./log');
const store = require('./store');
const { canUse } = require('./music/permissions');
const voting = require('./music/voting');
const { createCooldown } = require('./music/rate-limit');
const commandCooldown = createCooldown({ durationMs: 3000 });
const { createMemoryWatchdog } = require('./memory-watchdog');
const { startPresence } = require('./music/presence');
const music = require('./music/player');
const { showQueue } = require('./music/queue-view');
const { handleNowPlayingButton } = require('./np-controls');
const { handleJukeboxButton } = require('./jukebox-controls');
const { jukebox } = require('./music/jukebox');
const playlists = require('./music/playlist-store');
const { update: updateYtdlp, dest: ytdlpPath } = require('../scripts/update-ytdlp');
const embeds = require('./embeds');
const { flushStoresWithTimeout } = require('./music/shutdown');
const listeningStats = require('./music/listening-stats');
const processRegistry = require('./process-registry');
const { runStartupChecks, hasErrors, formatResult } = require('./startup-check');
const { enableFileLogging, getFileLog } = require('./log-file');
const { createErrorAlerts, createOwnerDm } = require('./error-alerts');
const { parseOwnerIds } = require('./music/cookies-status');


const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  makeCache: Options.cacheWithLimits({
    MessageManager: 0,
    ReactionManager: 0,
    PresenceManager: 0,
    GuildMemberManager: 25,
    UserManager: 25,
  }),
  sweepers: { messages: { interval: 300, lifetime: 60 } },
});

const byName = new Map(commands.map((c) => [c.data.name, c]));

client.once(Events.ClientReady, async (c) => {
  log.info(`Logged in as ${c.user.tag}`);
  startPresence(c, { getQueues: music.getQueues });
  try { await music.restoreQueues(c); }
  catch (error) { log.error('Failed to restore saved queues:', error); }
  // Re-attach request-channel players: show idle (or the restored track) after a restart.
  for (const guild of c.guilds.cache.values()) {
    const queue = music.getQueue(guild.id);
    jukebox.update(c, guild.id, queue?.current ? queue.getNowPlayingSnapshot() : null).catch(() => {});
  }
});

client.on(Events.InteractionCreate, async (i) => {
  if (i.isButton() && i.customId.startsWith('jb:') && i.inGuild()) {
    await handleJukeboxButton(i);
    return;
  }
  if (i.isButton() && i.customId.startsWith('np:') && i.inGuild()) {
    await handleNowPlayingButton(i);
    return;
  }
  if (i.isAutocomplete()) {
    const cmd = byName.get(i.commandName);
    if (!cmd?.autocomplete) return;
    try {
      await cmd.autocomplete(i);
    } catch (e) {
      log.error('Autocomplete failed:', e);
      await i.respond([]).catch(() => {});
    }
    return;
  }
  // Slash commands and the right-click "Play this" message command share one path (cooldown, permissions, errors).
  if (!(i.isChatInputCommand() || i.isMessageContextMenuCommand()) || !i.inGuild()) return;
  const cmd = byName.get(i.commandName);
  if (!cmd) return;
  try {
    if (['play', 'search', 'Play this'].includes(i.commandName)) {
      const rate = commandCooldown.check(`${i.guildId}:${i.user.id}:${i.commandName}`);
      if (!rate.allowed) {
        await i.reply({ embeds: [embeds.error(`Please wait ${(rate.retryAfterMs / 1000).toFixed(1)}s before using ${i.isChatInputCommand() ? `/${i.commandName}` : `“${i.commandName}”`} again.`)], ephemeral: true });
        return;
      }
    }
    if (i.commandName !== 'settings') {
      const settings = store.get(i.guildId);
      if (!canUse(i.member, i.commandName, settings, i.channelId)) {
        await i.reply({ embeds: [embeds.error(settings.textChannel && i.channelId !== settings.textChannel
          ? `Use music commands in <#${settings.textChannel}>.`
          : 'You need the configured DJ role or Manage Server permission to use this command.')], ephemeral: true });
        return;
      }
    }
    await cmd.execute(i);
  } catch (e) {
    log.error(e);
    const msg = { content: 'Something went wrong.', ephemeral: true };
    if (i.deferred || i.replied) i.followUp(msg).catch(() => {});
    else i.reply(msg).catch(() => {});
  }
});

client.on(Events.VoiceStateUpdate, music.handleVoiceUpdate);

process.on('unhandledRejection', (e) => log.error('unhandledRejection', e));
process.on('uncaughtException', (e) => log.error('uncaughtException', e));

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`Received ${signal}; shutting down.`);
  music.destroyAll({ preserve: true });
  const flushResult = await flushStoresWithTimeout([store, playlists, listeningStats, music], 5000);
  if (flushResult.timedOut) log.error('Store flush timed out during shutdown.');
  else flushResult.settled.filter((result) => result.status === 'rejected').forEach((result) => log.error('Store flush failed during shutdown:', result.reason));
  client.destroy();
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Windows does not stop child processes when the parent dies: never leave yt-dlp / ffmpeg running behind us.
process.on('exit', () => { processRegistry.killAll(); });
// A helper whose owner lost track of it (a bug, a hung download) is killed once it outlives its maximum age.
setInterval(() => {
  for (const stuck of processRegistry.sweep()) log.warn('Killed a stuck helper process', JSON.stringify(stuck));
}, 60_000).unref();

(async () => {
  enableFileLogging(log); // everything below is also written to data/logs/bot.log (rotated, size-capped)

  // Fail fast with a clear explanation instead of a cryptic crash (or silent audio) later.
  const checks = runStartupChecks();
  for (const result of checks.filter((r) => r.level === 'warn' || r.level === 'error')) (result.level === 'error' ? log.error : log.warn)(formatResult(result));
  if (hasErrors(checks)) {
    log.error('Fix the problem(s) above and start again. `npm run selftest` checks everything, including the network.');
    await getFileLog()?.flush();
    process.exit(1);
  }
  log.info(`Startup checks passed (${checks.filter((r) => r.level === 'ok').length} ok, ${checks.filter((r) => r.level === 'warn').length} warning(s)).`);

  const watchdog = createMemoryWatchdog({ clearCaches: music.clearCaches });
  watchdog.start();
  await Promise.all([store.load(), playlists.load(), listeningStats.load(), music.loadQueues()]);
  // Fetch yt-dlp on first run; refresh in background (YouTube changes break old versions).
  if (!fs.existsSync(ytdlpPath)) await updateYtdlp().catch((e) => log.error('yt-dlp download failed:', e.message));
  else updateYtdlp().catch(() => {});
  setInterval(() => updateYtdlp().catch(() => {}), 12 * 60 * 60 * 1000).unref();
  try {
    await client.login(process.env.DISCORD_TOKEN);
  } catch (error) {
    // A rejected token must not leave a half-started bot (timers, helpers) running with a cryptic stack trace.
    const hint = /token/i.test(String(error?.code || error?.message)) ? ' Check DISCORD_TOKEN in .env (reset it in the Developer Portal if unsure).' : '';
    log.error(`Could not log in to Discord: ${String(error?.message || error).replace(/\.$/, '')}.${hint}`);
    await getFileLog()?.flush();
    process.exit(1);
  }

  // The owner gets a DM when the same error keeps repeating (a broken host should not go unnoticed).
  const owners = parseOwnerIds(process.env.BOT_OWNER_ID);
  if (owners.length) {
    const alerts = createErrorAlerts({ send: createOwnerDm(client, owners) });
    log.addListener(({ level, line }) => { if (level === 'error') alerts.record({ line }); });
  }
})();

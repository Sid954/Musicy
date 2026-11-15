const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const store = require('../store');
const embeds = require('../embeds');
const music = require('../music/player');

const data = new SlashCommandBuilder().setName('settings').setDescription('View or change server music settings').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) => s.setName('view').setDescription('Show current settings'))
  .addSubcommand((s) => s.setName('dj-role').setDescription('Set or clear the DJ role').addRoleOption((o) => o.setName('role').setDescription('Role; omit to clear')))
  .addSubcommand((s) => s.setName('channel').setDescription('Restrict music commands to a channel').addChannelOption((o) => o.setName('channel').setDescription('Text channel; omit to clear').addChannelTypes(ChannelType.GuildText)))
  .addSubcommand((s) => s.setName('volume').setDescription('Set default volume').addIntegerOption((o) => o.setName('level').setDescription('1–200%').setMinValue(1).setMaxValue(200).setRequired(true)))
  .addSubcommand((s) => s.setName('24-7').setDescription('Toggle staying in voice when idle').addBooleanOption((o) => o.setName('enabled').setDescription('Enable 24/7').setRequired(true)))
  .addSubcommand((s) => s.setName('max-queue').setDescription('Set maximum queued tracks').addIntegerOption((o) => o.setName('count').setDescription('1–500').setMinValue(1).setMaxValue(500).setRequired(true)))
  .addSubcommand((s) => s.setName('now-playing').setDescription('What happens to the Now Playing card when a track ends').addStringOption((o) => o.setName('cleanup').setDescription('Card cleanup').setRequired(true).addChoices({ name: 'Collapse to a one-line summary', value: 'edit' }, { name: 'Delete the card', value: 'delete' }, { name: 'Keep it (buttons disabled)', value: 'keep' })))
  .addSubcommand((s) => s.setName('fade').setDescription('Fade tracks in and out (uses a little CPU; disables Opus passthrough)').addBooleanOption((o) => o.setName('enabled').setDescription('Enable fades').setRequired(true)))
  .addSubcommand((s) => s.setName('skip-duplicates').setDescription('Ignore songs that are already in the queue').addBooleanOption((o) => o.setName('enabled').setDescription('Skip duplicates').setRequired(true)))
  .addSubcommand((s) => s.setName('voice-status').setDescription('Show the current song as the voice channel status (needs the Set Voice Channel Status permission)').addBooleanOption((o) => o.setName('enabled').setDescription('Enable voice status').setRequired(true)))
  .addSubcommand((s) => s.setName('max-duration').setDescription('Set maximum track duration in seconds').addIntegerOption((o) => o.setName('seconds').setDescription('60–43200').setMinValue(60).setMaxValue(43200).setRequired(true)));

function format(settings) {
  return `DJ role: ${settings.djRole ? `<@&${settings.djRole}>` : 'not set'}\nCommand channel: ${settings.textChannel ? `<#${settings.textChannel}>` : 'any'}\nDefault volume: ${settings.volume}%\n24/7: ${settings.twentyFourSeven ? 'on' : 'off'}\nMax queue: ${settings.maxQueueLength}\nMax track duration: ${settings.maxTrackDuration}s
Now Playing cleanup: ${settings.cleanupNowPlaying}
Fades: ${settings.fade ? 'on' : 'off'}
Skip duplicates: ${settings.skipDuplicates ? 'on' : 'off'}
Voice status: ${settings.voiceStatus ? 'on' : 'off'}`;
}

module.exports = {
  data,
  async execute(i) {
    if (!i.member.permissions.has(PermissionFlagsBits.ManageGuild)) return i.reply({ embeds: [embeds.error('Manage Server permission is required.')], ephemeral: true });
    const sub = i.options.getSubcommand();
    const patch = {};
    if (sub === 'dj-role') patch.djRole = i.options.getRole('role')?.id || null;
    if (sub === 'channel') patch.textChannel = i.options.getChannel('channel')?.id || null;
    if (sub === 'volume') patch.volume = i.options.getInteger('level');
    if (sub === '24-7') patch.twentyFourSeven = i.options.getBoolean('enabled');
    if (sub === 'max-queue') patch.maxQueueLength = i.options.getInteger('count');
    if (sub === 'now-playing') patch.cleanupNowPlaying = i.options.getString('cleanup');
    if (sub === 'fade') patch.fade = i.options.getBoolean('enabled');
    if (sub === 'skip-duplicates') patch.skipDuplicates = i.options.getBoolean('enabled');
    if (sub === 'voice-status') patch.voiceStatus = i.options.getBoolean('enabled');
    if (sub === 'max-duration') patch.maxTrackDuration = i.options.getInteger('seconds');
    const settings = Object.keys(patch).length ? store.set(i.guildId, patch) : store.get(i.guildId);
    const queue = music.getQueue(i.guildId);
    if ('twentyFourSeven' in patch && queue) {
      queue.persist();
      if (!queue.current && !queue.tracks.length) queue.scheduleIdleDestroy();
    }
    if ('voiceStatus' in patch && queue) { if (patch.voiceStatus) queue.syncVoiceStatus(); else queue.clearVoiceStatus(); }
    if ('fade' in patch && queue) { queue.fade = Boolean(patch.fade); queue.refreshAnnouncement(); }
    await i.reply({ embeds: [embeds.info(format(settings))], ephemeral: true });
  },
};

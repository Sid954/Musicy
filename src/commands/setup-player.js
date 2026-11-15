const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const store = require('../store');
const embeds = require('../embeds');
const music = require('../music/player');
const log = require('../log');
const { buildJukeboxCard } = require('../music/jukebox-view');

async function deleteOldController(guild, config) {
  if (!config) return;
  try {
    const channel = guild.channels.cache.get(config.channelId) || await guild.channels.fetch(config.channelId);
    const message = await channel.messages.fetch(config.messageId);
    await message.delete();
  } catch { /* already gone */ }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup-player')
    .setDescription('Create a request channel player: one message with buttons to add songs')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('create').setDescription('Post the player message')
      .addChannelOption((o) => o.setName('channel').setDescription('Text channel (default: this one)').addChannelTypes(ChannelType.GuildText)))
    .addSubcommand((s) => s.setName('remove').setDescription('Remove the player message')),
  async execute(i) {
    if (!i.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return i.reply({ embeds: [embeds.error('Manage Server permission is required.')], ephemeral: true });
    }
    const existing = store.get(i.guildId).jukebox;
    if (i.options.getSubcommand() === 'remove') {
      if (!existing) return i.reply({ embeds: [embeds.error('No player message is set up.')], ephemeral: true });
      await deleteOldController(i.guild, existing);
      store.set(i.guildId, { jukebox: null });
      return i.reply({ embeds: [embeds.info('Player message removed.')], ephemeral: true });
    }

    const channel = i.options.getChannel('channel') || i.channel;
    if (!channel?.isTextBased?.() || channel.type !== ChannelType.GuildText) {
      return i.reply({ embeds: [embeds.error('Choose a normal text channel.')], ephemeral: true });
    }
    await i.deferReply({ ephemeral: true });
    try {
      const queue = music.getQueue(i.guildId);
      const { embed, rows } = buildJukeboxCard(queue?.current ? queue.getNowPlayingSnapshot() : null);
      const message = await channel.send({ embeds: [embed], components: rows });
      await deleteOldController(i.guild, existing);
      store.set(i.guildId, { jukebox: { channelId: channel.id, messageId: message.id } });
      await i.editReply({ embeds: [embeds.info(`Player created in ${channel}. Tip: pin the message. Songs requested there won't spam the channel with now-playing cards.`)] });
    } catch (error) {
      log.warn('setup-player failed:', error.message);
      await i.editReply({ embeds: [embeds.error(`I couldn't post in ${channel}: ${error.message}. Check that I can view and send messages there.`)] });
    }
  },
};

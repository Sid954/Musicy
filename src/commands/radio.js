const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, EmbedBuilder } = require('discord.js');
const music = require('../music/player');
const embeds = require('../embeds');
const log = require('../log');
const { authorize } = require('./_util');
const { replyWithCard } = require('./_card');
const { STATIONS, findStation, stationToTrack, buildStationOptions } = require('../music/stations');

const menu = (disabled = false) => new ActionRowBuilder().addComponents(
  new StringSelectMenuBuilder().setCustomId('radio:pick').setPlaceholder('Choose a station').setDisabled(disabled).addOptions(buildStationOptions()),
);
const card = (expired = false) => new EmbedBuilder()
  .setColor(expired ? 0x747f8d : 0x1abc9c)
  .setTitle('📻 Radio stations')
  .setDescription(STATIONS.map((station) => `**${station.name}**\n└ ${station.genre}`).join('\n'))
  .setFooter({ text: expired ? 'This menu expired.' : 'Live streams · pick one below · expires in 60s' });

module.exports = {
  data: new SlashCommandBuilder().setName('radio').setDescription('Listen to a live radio station'),
  async execute(i) {
    if (!await authorize(i)) return;
    if (!i.member.voice.channel) return i.reply({ embeds: [embeds.error('Join a voice channel first.')], ephemeral: true });
    await i.reply({ embeds: [card()], components: [menu()] });
    const message = await i.fetchReply();
    const collector = message.createMessageComponentCollector({ time: 60_000, filter: (c) => c.customId === 'radio:pick' });

    collector.on('collect', async (c) => {
      try {
        if (c.user.id !== i.user.id) {
          await c.reply({ embeds: [embeds.error(`Only ${i.member.displayName} can choose a station here.`)], ephemeral: true });
          return;
        }
        const station = findStation(c.values[0]);
        const userChannel = c.member.voice?.channel;
        if (!station) return;
        if (!userChannel) {
          await c.reply({ embeds: [embeds.error('Join a voice channel first.')], ephemeral: true });
          return;
        }
        const botChannelId = c.guild.members.me?.voice?.channelId;
        if (botChannelId && botChannelId !== userChannel.id) {
          await c.reply({ embeds: [embeds.error(`I’m already in <#${botChannelId}>. Join it first.`)], ephemeral: true });
          return;
        }

        await c.deferUpdate();
        const track = stationToTrack(station);
        track.requestedBy = c.member.displayName;
        track.requestedById = c.user.id;
        const queue = music.getOrCreate(c.guildId, userChannel, c.channel);
        collector.stop('done');
        if (!queue.current && queue.player.state.status === 'idle') {
          queue.enqueue([track]);
          await replyWithCard(c, queue, track);
        } else {
          // Something is playing: the station takes over right away; the queue resumes after it.
          queue.playNext([track]);
          queue.skip();
          await c.editReply({ embeds: [embeds.info(`📻 Tuning in to **${station.name}**. Your queue continues after it.`)], components: [] });
        }
      } catch (error) {
        log.error('Radio pick failed:', error);
        const reply = { embeds: [embeds.error(`Could not start the station: ${error.message}`)], components: [] };
        if (c.deferred || c.replied) await c.editReply(reply).catch(() => {});
        else await c.reply({ ...reply, ephemeral: true }).catch(() => {});
      }
    });
    collector.on('end', (_collected, reason) => {
      if (reason === 'done') return;
      i.editReply({ embeds: [card(true)], components: [menu(true)] }).catch(() => {});
    });
  },
};

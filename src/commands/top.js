const { SlashCommandBuilder } = require('discord.js');
const embeds = require('../embeds');
const stats = require('../music/listening-stats');
const { showPaginatedList } = require('../music/list-view');
const { formatTotal } = require('../music/collection');
const { linkText } = require('../music/pager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('top')
    .setDescription('Listening statistics for this server')
    .addSubcommand((s) => s.setName('tracks').setDescription('Most played tracks'))
    .addSubcommand((s) => s.setName('users').setDescription('Who requests the most music')),
  async execute(i) {
    const sub = i.options.getSubcommand();
    const overview = stats.summary(i.guildId);
    if (!overview.totalPlays) return i.reply({ embeds: [embeds.info('No listening statistics yet. Play some music first!')], ephemeral: true });
    const header = `${overview.totalPlays} plays · ${formatTotal(overview.totalSeconds)} listened`;
    if (sub === 'tracks') {
      return showPaginatedList(i, {
        title: `🏆 Top tracks · ${header}`,
        items: stats.topTracks(i.guildId),
        prefix: 'top',
        perPage: 10,
        ephemeral: false,
        formatItem: (item) => `${item.url ? `[${linkText(item.title, 60)}](${item.url})` : linkText(item.title, 60)} · **${item.plays}** play${item.plays === 1 ? '' : 's'}`,
      });
    }
    return showPaginatedList(i, {
      title: `🎧 Top listeners · ${header}`,
      items: stats.topUsers(i.guildId),
      prefix: 'top',
      perPage: 10,
      ephemeral: false,
      formatItem: (item) => `<@${item.id}> · **${item.plays}** request${item.plays === 1 ? '' : 's'}${item.seconds ? ` · ${formatTotal(item.seconds)}` : ''}`,
    });
  },
};

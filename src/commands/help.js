const { SlashCommandBuilder, ApplicationCommandType } = require('discord.js');
const embeds = require('../embeds');

module.exports = {
  data: new SlashCommandBuilder().setName('help').setDescription('List music bot commands'),
  async execute(i) {
    const all = require('./index').filter((command) => command.data.name !== 'help');
    // Right-click (context menu) commands have a type and no description.
    const messageCommands = all.filter((command) => command.data.type === ApplicationCommandType.Message);
    const slashCommands = all.filter((command) => !command.data.type || command.data.type === ApplicationCommandType.ChatInput);
    const lines = slashCommands.map((command) => `**/${command.data.name}** — ${command.data.description}`);
    if (messageCommands.length) {
      lines.push('', `**Right-click a message → Apps:** ${messageCommands.map((command) => `**${command.data.name}**`).join(', ')}`);
    }
    await i.reply({ embeds: [embeds.info(lines.join('\n').slice(0, 4000))], ephemeral: true });
  },
};

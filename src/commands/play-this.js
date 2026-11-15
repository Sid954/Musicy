// Right-click a message -> Apps -> "Play this": plays the link, audio file or song name in that message.
const { ContextMenuCommandBuilder, ApplicationCommandType, InteractionContextType } = require('discord.js');
const embeds = require('../embeds');
const { extractPlayQuery } = require('../music/message-query');
const { playQuery } = require('./_play-flow');

module.exports = {
  // Servers only: the bot has nothing to join in a DM.
  data: new ContextMenuCommandBuilder().setName('Play this').setType(ApplicationCommandType.Message).setContexts([InteractionContextType.Guild]),
  async execute(i) {
    const found = extractPlayQuery(i.targetMessage);
    if (!found) {
      return i.reply({ embeds: [embeds.error('I couldn’t find a link, audio file or song name in that message.')], ephemeral: true });
    }
    return playQuery(i, found.query);
  },
};

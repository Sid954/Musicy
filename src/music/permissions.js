const RESTRICTED_COMMANDS = new Set(['forceskip', 'stop', 'clear', 'remove', 'move', 'shuffle', 'skipto', 'volume', 'filter', 'seek', 'restart', 'autoplay', 'normalize', 'sponsorblock', 'previous', 'speed', 'pitch', 'eq', 'sleep', 'dedupe', 'jump', 'radio', 'undo']);

function canUse(member, commandName, settings = {}, channelId = null) {
  if (settings.textChannel && channelId && channelId !== settings.textChannel) return false;
  if (!RESTRICTED_COMMANDS.has(commandName) || !settings.djRole) return true;
  if (member?.permissions?.has?.('ManageGuild') || member?.permissions?.has?.('Administrator')) return true;
  return Boolean(member?.roles?.cache?.has?.(settings.djRole));
}

module.exports = { canUse, RESTRICTED_COMMANDS };

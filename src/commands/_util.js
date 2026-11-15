const music = require('../music/player');
const embeds = require('../embeds');
const store = require('../store');
const { canUse } = require('../music/permissions');

const reply = (i, text, ephemeral = false) => i.reply({ embeds: [embeds.info(text)], ephemeral });

async function authorize(i) {
  const settings = store.get(i.guildId);
  if (canUse(i.member, i.commandName, settings, i.channelId)) return true;
  await i.reply({ embeds: [embeds.error(settings.textChannel && i.channelId !== settings.textChannel
    ? `Use music commands in <#${settings.textChannel}>.`
    : 'You need the configured DJ role or Manage Server permission to use this command.')], ephemeral: true });
  return false;
}

// Returns the guild queue if the user is in the same voice channel, else replies with an error.
async function needQueue(i) {
  const q = music.getQueue(i.guildId);
  if (!q) {
    await i.reply({ embeds: [embeds.error('Nothing is playing.')], ephemeral: true });
    return null;
  }
  if (i.member.voice.channelId !== i.guild.members.me.voice.channelId) {
    await i.reply({ embeds: [embeds.error('Join my voice channel first.')], ephemeral: true });
    return null;
  }
  return q;
}

module.exports = { reply, needQueue, authorize };

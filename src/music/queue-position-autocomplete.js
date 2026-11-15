const MAX_CHOICES = 25;
const MAX_NAME = 100;

function queuePositionChoices(tracks, focused, limit = MAX_CHOICES) {
  const query = String(focused ?? '').trim().toLowerCase();
  if (!Array.isArray(tracks) || !tracks.length) return [];
  return tracks.reduce((choices, track, index) => {
    if (choices.length >= Math.min(MAX_CHOICES, limit)) return choices;
    const position = index + 1;
    const title = String(track?.title || 'Unknown');
    const label = `${position}. ${title}`.slice(0, MAX_NAME);
    const matches = !query || String(position).startsWith(query) || title.toLowerCase().includes(query);
    if (matches) choices.push({ name: label, value: position });
    return choices;
  }, []);
}

async function respondQueuePositions(interaction) {
  try {
    const music = require('./player');
    const queue = music.getQueue(interaction.guildId);
    const focused = interaction.options.getFocused();
    await interaction.respond(queuePositionChoices(queue?.tracks || [], focused));
  } catch (error) {
    require('../log').error('Queue position autocomplete failed:', error);
    await interaction.respond([]).catch(() => {});
  }
}

module.exports = { MAX_CHOICES, MAX_NAME, queuePositionChoices, respondQueuePositions };

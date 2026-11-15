// Replies with the live Now Playing card (embed + controls) and makes that reply the card the queue keeps updating.
const { buildNowPlayingCard } = require('../music/nowplaying-view');
const log = require('../log');

// `interaction` must be deferred/replied (uses editReply) unless `reply` is true.
async function replyWithCard(interaction, queue, track, { footer } = {}) {
  const { embed, rows } = buildNowPlayingCard(queue.getNowPlayingSnapshot(track, footer));
  await interaction.editReply({ embeds: [embed], components: rows });
  try {
    const message = await interaction.fetchReply();
    queue.adoptAnnouncement(message, track);
  } catch (error) {
    log.warn('Could not adopt now-playing reply:', error.message);
  }
}

module.exports = { replyWithCard };

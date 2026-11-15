function validateEnqueue({ queuedCount, incoming, maxQueueLength = 500, maxTrackDuration = 10800 }) {
  if (queuedCount + incoming.length > maxQueueLength) throw new Error(`The queue limit is ${maxQueueLength} tracks.`);
  const tooLong = incoming.find((track) => track.duration > 0 && track.duration > maxTrackDuration);
  if (tooLong) throw new Error(`**${tooLong.title}** exceeds the ${maxTrackDuration}-second track limit.`);
  return true;
}

module.exports = { validateEnqueue };

function getPresenceText(queues, guildCount) {
  const playing = [...queues].filter((queue) => queue.current);
  if (playing.length === 1) return `♫ ${String(playing[0].current.title || 'Music').slice(0, 92)}`;
  return `/play | ${guildCount} servers`;
}

function startPresence(client, { getQueues, intervalMs = 30_000 } = {}) {
  const update = () => {
    if (!client.user) return;
    client.user.setActivity(getPresenceText(getQueues(), client.guilds.cache.size));
  };
  update();
  const timer = setInterval(update, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

module.exports = { getPresenceText, startPresence };

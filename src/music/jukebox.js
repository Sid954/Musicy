// Keeps each server's request-channel player message up to date (idle <-> now playing).
// Updates are coalesced: at most one edit per interval per server, always with the latest state.
const store = require('../store');
const log = require('../log');
const { buildJukeboxCard } = require('./jukebox-view');

const MIN_INTERVAL_MS = 2000;

function createJukebox({
  getSettings = (guildId) => store.get(guildId),
  setSettings = (guildId, patch) => store.set(guildId, patch),
  minIntervalMs = MIN_INTERVAL_MS,
  now = Date.now,
  schedule = setTimeout,
} = {}) {
  const states = new Map(); // guildId -> { lastAt, timer, pending, messages }

  const stateFor = (guildId) => {
    if (!states.has(guildId)) states.set(guildId, { lastAt: 0, timer: null, pending: null, message: null });
    return states.get(guildId);
  };

  async function resolveMessage(client, guildId, config, state) {
    if (state.message?.id === config.messageId) return state.message;
    try {
      const channel = client.channels.cache.get(config.channelId) || await client.channels.fetch(config.channelId);
      state.message = await channel.messages.fetch(config.messageId);
      return state.message;
    } catch {
      // The channel or message was deleted: forget the controller instead of retrying forever.
      state.message = null;
      setSettings(guildId, { jukebox: null });
      return null;
    }
  }

  async function send(client, guildId, snapshot) {
    const config = getSettings(guildId)?.jukebox;
    if (!config) return false;
    const state = stateFor(guildId);
    state.lastAt = now();
    const message = await resolveMessage(client, guildId, config, state);
    if (!message) return false;
    const { embed, rows } = buildJukeboxCard(snapshot);
    try {
      await message.edit({ embeds: [embed], components: rows });
      return true;
    } catch (error) {
      log.warn('Could not update the player message:', error.message);
      return false;
    }
  }

  // `snapshot` is a Now Playing snapshot, or null when nothing is playing.
  function update(client, guildId, snapshot) {
    if (!client || !getSettings(guildId)?.jukebox) return Promise.resolve(false);
    const state = stateFor(guildId);
    const wait = state.lastAt + minIntervalMs - now();
    if (wait <= 0 && !state.timer) return send(client, guildId, snapshot);
    state.pending = { client, snapshot }; // newest state wins
    if (!state.timer) {
      state.timer = schedule(() => {
        state.timer = null;
        const pending = state.pending;
        state.pending = null;
        if (pending) send(pending.client, guildId, pending.snapshot).catch(() => {});
      }, Math.max(0, wait));
      state.timer?.unref?.();
    }
    return Promise.resolve(true);
  }

  return { update, forget: (guildId) => { const s = states.get(guildId); if (s?.timer) clearTimeout(s.timer); states.delete(guildId); } };
}

module.exports = { MIN_INTERVAL_MS, createJukebox, jukebox: createJukebox() };

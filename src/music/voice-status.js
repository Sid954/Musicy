// Sets the voice channel "status" line to the current track (needs the Set Voice Channel Status permission).
// Everything is best-effort and silent: a missing permission only pauses attempts for a while.
const { displayTitle } = require('./title');
const { clip } = require('./pager');
const log = require('../log');

const MAX_STATUS = 500;
const BACKOFF_MS = 10 * 60_000;

function formatVoiceStatus(track) {
  if (!track) return '';
  return clip(`🎵 ${displayTitle(track.title)}`, MAX_STATUS);
}

// `rest` is discord.js's client.rest (or any object with put(route, { body })).
function createVoiceStatusUpdater({ rest, now = Date.now }) {
  let blockedUntil = 0;
  const last = new Map(); // channelId -> last status we sent

  async function send(channelId, status) {
    if (!rest || !channelId || now() < blockedUntil) return false;
    if (last.get(channelId) === status) return true;
    try {
      await rest.put(`/channels/${channelId}/voice-status`, { body: { status } });
      last.set(channelId, status);
      return true;
    } catch (error) {
      const code = error?.code ?? error?.rawError?.code;
      if (code === 50013 || error?.status === 403 || error?.status === 404) blockedUntil = now() + BACKOFF_MS;
      log.debug?.('Voice status update skipped:', error?.message);
      return false;
    }
  }

  return {
    set: (channelId, track) => send(channelId, formatVoiceStatus(track)),
    // Only talks to Discord if we previously set a status on that channel.
    clear: (channelId) => { if (!last.has(channelId)) return Promise.resolve(false); last.delete(channelId); return send(channelId, ''); },
    get blocked() { return now() < blockedUntil; },
  };
}

module.exports = { MAX_STATUS, BACKOFF_MS, formatVoiceStatus, createVoiceStatusUpdater };

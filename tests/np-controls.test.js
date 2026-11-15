const test = require('node:test');
const assert = require('node:assert/strict');

// Stub the player + settings before the router loads (no Discord, no audio, no disk).
const playerPath = require.resolve('../src/music/player');
const storePath = require.resolve('../src/store');
const playlistPath = require.resolve('../src/music/playlist-store');
let queue = null;
let settings = { djRole: null, textChannel: null };
const favorites = {};
require.cache[playerPath] = { id: playerPath, filename: playerPath, loaded: true, exports: { getQueue: () => queue } };
require.cache[storePath] = { id: storePath, filename: storePath, loaded: true, exports: { get: () => settings, set() {} } };
require.cache[playlistPath] = { id: playlistPath, filename: playlistPath, loaded: true, exports: {
  get: (u, n) => favorites[`${u}:${n}`] || null,
  create: (u, n) => { favorites[`${u}:${n}`] = []; },
  add: (u, n, t) => { favorites[`${u}:${n}`].push(...t); },
} };
const { handleNowPlayingButton } = require('../src/np-controls');

const makeQueue = () => ({
  current: { title: 'Song', requestedById: 'owner', duration: 200 },
  tracks: [{}, {}, {}], loop: 'off', opts: { volume: 1 }, skipVotes: new Set(), refreshed: 0, calls: [],
  player: { state: { status: 'playing' }, pause() { this.state.status = 'paused'; }, unpause() { this.state.status = 'playing'; } },
  refreshAnnouncement() { this.refreshed++; return Promise.resolve(); },
  skip() { this.calls.push('skip'); }, stop() { this.calls.push('stop'); }, shuffle() { this.calls.push('shuffle'); },
  previous() { this.calls.push('previous'); return this.prev || null; }, applyVolume(level) { this.calls.push(`volume:${level}`); return level; },
});

function click(customId, { userId = 'owner', channelId = 'v1', manage = false, roles = [], humans = 1, textChannelId = 'music' } = {}) {
  const replies = [];
  return {
    replies,
    interaction: {
      customId, guildId: 'g', channelId: textChannelId, user: { id: userId },
      guild: { members: { me: { voice: { channelId: 'v1' } } } },
      member: {
        voice: { channelId, channel: { members: { filter: () => ({ size: humans }) } } },
        permissions: { has: (flag) => manage && (flag === 'ManageGuild' || flag === 'Administrator') },
        roles: { cache: { has: (id) => roles.includes(id), keys: () => roles[Symbol.iterator]() } },
      },
      async reply(payload) { replies.push(payload); },
    },
  };
}
const text = (payload) => payload.content || payload.embeds?.[0]?.toJSON().description || '';

test('np router: nothing playing and wrong voice channel are rejected', async () => {
  queue = null;
  let c = click('np:pause');
  await handleNowPlayingButton(c.interaction);
  assert.match(text(c.replies[0]), /Nothing is playing/);
  queue = makeQueue();
  c = click('np:pause', { channelId: 'other' });
  await handleNowPlayingButton(c.interaction);
  assert.match(text(c.replies[0]), /Join my voice channel/);
  assert.equal(queue.refreshed, 0);
});

test('np router: pause toggles and re-renders the whole card, loop cycles', async () => {
  queue = makeQueue();
  let c = click('np:pause');
  await handleNowPlayingButton(c.interaction);
  assert.equal(queue.player.state.status, 'paused');
  assert.equal(queue.refreshed, 1);
  assert.match(text(c.replies[0]), /Paused/);
  c = click('np:pause');
  await handleNowPlayingButton(c.interaction);
  assert.equal(queue.player.state.status, 'playing');
  const seen = [];
  for (let n = 0; n < 3; n++) { await handleNowPlayingButton(click('np:loop').interaction); seen.push(queue.loop); }
  assert.deepEqual(seen, ['track', 'queue', 'off']);
  assert.equal(queue.refreshed, 2 + 3);
});

test('np router: skip needs a vote from a non-requester when more than two listen, requester skips instantly', async () => {
  queue = makeQueue();
  let c = click('np:skip', { userId: 'owner', humans: 5 });
  await handleNowPlayingButton(c.interaction);
  assert.deepEqual(queue.calls, ['skip']);
  queue = makeQueue();
  c = click('np:skip', { userId: 'stranger', humans: 5 });
  await handleNowPlayingButton(c.interaction);
  assert.deepEqual(queue.calls, []);
  assert.match(text(c.replies[0]), /Skip vote: 1\//);
  c = click('np:skip', { userId: 'stranger', humans: 5 });
  await handleNowPlayingButton(c.interaction);
  assert.match(text(c.replies[0]), /already voted/);
});

test('np router: DJ-restricted buttons (stop, shuffle, previous, volume) honour the DJ role', async () => {
  settings = { djRole: 'dj', textChannel: null };
  for (const action of ['stop', 'shuffle', 'prev', 'voldown', 'volup']) {
    queue = makeQueue();
    const c = click(`np:${action}`, { userId: 'random' });
    await handleNowPlayingButton(c.interaction);
    assert.deepEqual(queue.calls, [], `${action} must be denied without the DJ role`);
    assert.match(text(c.replies[0]), /DJ role|Manage Server/);
  }
  queue = makeQueue();
  await handleNowPlayingButton(click('np:stop', { roles: ['dj'] }).interaction);
  await handleNowPlayingButton(click('np:shuffle', { manage: true }).interaction);
  assert.deepEqual(queue.calls, ['stop', 'shuffle']);
  // Unrestricted buttons still work for everyone.
  queue = makeQueue();
  await handleNowPlayingButton(click('np:pause', { userId: 'random' }).interaction);
  assert.equal(queue.player.state.status, 'paused');
  settings = { djRole: null, textChannel: null };
});

test('np router: previous, shuffle and volume buttons call the queue and answer ephemerally', async () => {
  queue = makeQueue();
  queue.prev = { title: 'Earlier Song' };
  let c = click('np:prev');
  await handleNowPlayingButton(c.interaction);
  assert.match(text(c.replies[0]), /Earlier Song/);
  assert.equal(c.replies[0].ephemeral, true);
  queue.prev = null;
  c = click('np:prev');
  await handleNowPlayingButton(c.interaction);
  assert.match(text(c.replies[0]), /no previous track/);
  await handleNowPlayingButton(click('np:shuffle').interaction);
  queue.opts.volume = 0.8;
  await handleNowPlayingButton(click('np:voldown').interaction);
  queue.opts.volume = 1.95;
  await handleNowPlayingButton(click('np:volup').interaction);
  assert.deepEqual(queue.calls, ['previous', 'previous', 'shuffle', 'volume:70', 'volume:200']);
  assert.ok(queue.refreshed >= 1);
});

test('np router: favorite saves the current track once per press into the clicker\'s favorites', async () => {
  queue = makeQueue();
  const c = click('np:favorite', { userId: 'fan' });
  await handleNowPlayingButton(c.interaction);
  assert.equal(favorites['fan:favorites'].length, 1);
  assert.match(text(c.replies[0]), /Saved \*\*Song\*\*/);
});

test('np router: commands channel restriction applies to the buttons', async () => {
  settings = { djRole: null, textChannel: 'music' };
  queue = makeQueue();
  const c = click('np:pause', { textChannelId: 'general' });
  await handleNowPlayingButton(c.interaction);
  assert.match(text(c.replies[0]), /Use music controls in <#music>/);
  assert.equal(queue.player.state.status, 'playing');
  settings = { djRole: null, textChannel: null };
});

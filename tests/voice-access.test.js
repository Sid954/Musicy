const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { describeVoiceAccess, MUTED_MESSAGE } = require('../src/music/voice-access');

const channel = ({ allowed = ['ViewChannel', 'Connect', 'Speak'], userLimit = 0, size = 0, name = 'General', inside = false } = {}) => ({
  id: 'v1', name, userLimit, members: { size },
  guild: { members: { me: { voice: { channelId: inside ? 'v1' : null } } } },
  permissionsFor: () => ({ has: (flag) => allowed.includes(flag) }),
  toString: () => `#${name}`,
});

test('ok when the bot can view, connect and speak', () => {
  assert.equal(describeVoiceAccess(channel()), null);
  assert.equal(describeVoiceAccess({ id: 'x' }), null, 'channels without permission data are assumed fine');
});

test('names exactly which permissions are missing', () => {
  assert.match(describeVoiceAccess(channel({ allowed: ['ViewChannel', 'Connect'] })), /missing the \*\*Speak\*\* permission\. Ask a server admin to allow it/);
  const several = describeVoiceAccess(channel({ allowed: [] }));
  assert.match(several, /\*\*View Channel\*\*, \*\*Connect\*\*, \*\*Speak\*\* permissions/);
  assert.match(several, /allow them/);
  assert.match(describeVoiceAccess(null), /could not find/);
});

test('a full channel blocks joining unless the bot has Manage Channels or is already inside', () => {
  assert.match(describeVoiceAccess(channel({ userLimit: 2, size: 2 })), /is full \(2 people\)/);
  assert.equal(describeVoiceAccess(channel({ userLimit: 2, size: 1 })), null);
  assert.equal(describeVoiceAccess(channel({ userLimit: 2, size: 2, allowed: ['ViewChannel', 'Connect', 'Speak', 'ManageChannels'] })), null);
  assert.equal(describeVoiceAccess(channel({ userLimit: 2, size: 2, inside: true })), null);
  assert.equal(describeVoiceAccess(channel({ userLimit: 0, size: 99 })), null, 'no limit');
});

// ---- real queue ----
const storePath = require.resolve('../src/store');
require.cache[storePath] = { id: storePath, filename: storePath, loaded: true, exports: { get: () => ({ volume: 100, filterPresets: [], cleanupNowPlaying: 'edit' }), set: () => ({}) } };
require('../src/music/queue-store').createQueueStore = () => ({ delete() {}, set() {}, entries: () => [], flush: async () => {}, load: async () => {} });
require('../src/music/sources/youtube').stream = async () => ({ stream: new PassThrough(), kill() {} });
const music = require('../src/music/player');

const adapter = () => ({ sendPayload: () => true, destroy() {} });
const sent = [];
const text = { id: 't', send: async (payload) => { sent.push(payload); return { edit: async () => {}, delete: async () => {} }; } };

test('getOrCreate refuses to join a channel the bot cannot speak in, with the reason', () => {
  const bad = { ...channel({ allowed: ['ViewChannel', 'Connect'] }), guild: { voiceAdapterCreator: adapter, members: { me: { voice: {} } } } };
  assert.throws(() => music.getOrCreate('perm-g', bad, text), /missing the \*\*Speak\*\* permission/);
  assert.equal(music.getQueue('perm-g'), undefined, 'no half-created queue');
  const good = { ...channel(), guild: { voiceAdapterCreator: adapter, members: { me: { voice: {} } } } };
  const q = music.getOrCreate('perm-g', good, text);
  assert.ok(q);
  assert.equal(music.getOrCreate('perm-g', bad, text), q, 'an existing queue is reused without re-checking');
  q.destroy();
});

test('being server-muted is announced once, and again only after an unmute/mute cycle', () => {
  const vc = { ...channel(), guild: { voiceAdapterCreator: adapter, members: { me: { id: 'bot', voice: {} } }, channels: { cache: new Map() } } };
  const q = music.getOrCreate('mute-g', vc, text);
  const guild = { id: 'mute-g', members: { me: { id: 'bot', voice: { channel: null } } }, channels: { cache: new Map() } };
  const state = (serverMute, channelId = 'v1') => ({ id: 'bot', guild, channelId, serverMute });
  sent.length = 0;
  music.handleVoiceUpdate(state(false), state(true));
  assert.equal(sent.length, 1);
  assert.match(sent[0].embeds[0].toJSON().description, /server-muted/);
  music.handleVoiceUpdate(state(true), state(true));
  assert.equal(sent.length, 1, 'no repeat while still muted');
  music.handleVoiceUpdate(state(true), state(false));
  music.handleVoiceUpdate(state(false), state(true));
  assert.equal(sent.length, 2, 'warned again after being unmuted and muted again');
  assert.ok(MUTED_MESSAGE.includes('Server Mute'));
  q.destroy();
});

test.after(() => { for (const id of ['perm-g', 'mute-g']) music.getQueue(id)?.destroy(); });

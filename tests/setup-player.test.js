const test = require('node:test');
const assert = require('node:assert/strict');

const storePath = require.resolve('../src/store');
let settings = { jukebox: null };
const sets = [];
require.cache[storePath] = { id: storePath, filename: storePath, loaded: true, exports: { get: () => settings, set: (_g, patch) => { sets.push(patch); settings = { ...settings, ...patch }; return settings; } } };
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const command = require('../src/commands/setup-player');

const text = (payload) => payload?.embeds?.[0]?.toJSON?.().description || '';

function interaction({ sub = 'create', channel, manage = true, current } = {}) {
  const log = [];
  const posted = [];
  const deleted = [];
  const textChannel = current || { id: 'c-here', type: ChannelType.GuildText, isTextBased: () => true, toString: () => '#here', send: async (payload) => { posted.push(payload); return { id: `msg-${posted.length}` }; } };
  const i = {
    guildId: 'g', channel: textChannel,
    member: { permissions: { has: (flag) => manage && flag === PermissionFlagsBits.ManageGuild } },
    guild: {
      channels: {
        cache: new Map([['old-c', { messages: { fetch: async (id) => ({ delete: async () => { deleted.push(id); } }) } }]]),
        fetch: async () => { throw new Error('not found'); },
      },
    },
    options: { getSubcommand: () => sub, getChannel: () => channel || null },
    reply: async (o) => { log.push(['reply', o]); },
    deferReply: async () => { log.push(['defer']); },
    editReply: async (o) => { log.push(['edit', o]); },
  };
  return { i, log, posted, deleted };
}

test('create posts the idle player card with its buttons and remembers channel + message', async () => {
  settings = { jukebox: null };
  const c = interaction();
  await command.execute(c.i);
  assert.equal(c.posted.length, 1);
  assert.match(c.posted[0].embeds[0].toJSON().description, /Add song/);
  assert.deepEqual(c.posted[0].components[0].toJSON().components.map((b) => b.custom_id), ['jb:add', 'jb:pause', 'jb:skip', 'jb:stop', 'jb:queue']);
  assert.deepEqual(sets.at(-1), { jukebox: { channelId: 'c-here', messageId: 'msg-1' } });
  assert.match(text(c.log.at(-1)[1]), /Player created/);
});

test('creating again replaces (deletes) the previous player message', async () => {
  settings = { jukebox: { channelId: 'old-c', messageId: 'old-msg' } };
  const c = interaction();
  await command.execute(c.i);
  assert.deepEqual(c.deleted, ['old-msg']);
  assert.equal(settings.jukebox.messageId, 'msg-1');
});

test('remove deletes the message and clears the setting; removing nothing is an error', async () => {
  settings = { jukebox: { channelId: 'old-c', messageId: 'old-msg' } };
  const c = interaction({ sub: 'remove' });
  await command.execute(c.i);
  assert.deepEqual(c.deleted, ['old-msg']);
  assert.equal(settings.jukebox, null);
  const none = interaction({ sub: 'remove' });
  await command.execute(none.i);
  assert.match(text(none.log[0][1]), /No player message/);
});

test('needs Manage Server, a normal text channel, and reports posting failures kindly', async () => {
  settings = { jukebox: null };
  const denied = interaction({ manage: false });
  await command.execute(denied.i);
  assert.match(text(denied.log[0][1]), /Manage Server/);
  assert.equal(denied.posted.length, 0);

  const voice = { id: 'v', type: ChannelType.GuildVoice, isTextBased: () => true };
  const wrong = interaction({ channel: voice });
  await command.execute(wrong.i);
  assert.match(text(wrong.log[0][1]), /normal text channel/);

  const broken = interaction({ current: { id: 'c2', type: ChannelType.GuildText, isTextBased: () => true, toString: () => '#c2', send: async () => { throw new Error('Missing Permissions'); } } });
  await command.execute(broken.i);
  assert.match(text(broken.log.at(-1)[1]), /couldn't post in #c2: Missing Permissions/);
  assert.equal(settings.jukebox, null, 'nothing saved when the post failed');
});

test('command is restricted to Manage Server by default in Discord', () => {
  const json = command.data.toJSON();
  assert.equal(json.default_member_permissions, String(PermissionFlagsBits.ManageGuild));
  assert.deepEqual(json.options.map((o) => o.name), ['create', 'remove']);
});

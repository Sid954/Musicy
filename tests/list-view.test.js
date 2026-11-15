const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { buildListEmbed, buildListRows, showPaginatedList } = require('../src/music/list-view');
const makeTracks = (count) => Array.from({ length: count }, (_, index) => ({ title: `Track ${index + 1}`, duration: 120 }));

class FakeCollector extends EventEmitter {
  stop(reason) { this.emit('end', [], reason); }
}

function fakeInteraction(userId = 'owner') {
  const collector = new FakeCollector();
  const message = { createMessageComponentCollector: () => collector };
  return {
    user: { id: userId }, calls: [], collector, deferred: false,
    async deferReply(payload) { this.deferred = true; this.calls.push(['deferReply', payload]); },
    async reply(payload) { this.calls.push(['reply', payload]); },
    async editReply(payload) { this.calls.push(['editReply', payload]); },
    async fetchReply() { return message; },
  };
}

function component(userId, customId) {
  return {
    user: { id: userId }, customId, deferred: false, replied: false,
    async deferUpdate() { this.deferred = true; },
    async update(payload) { this.updated = payload; this.deferred = true; },
    async reply(payload) { this.replyPayload = payload; this.replied = true; },
    async followUp(payload) { this.followUpPayload = payload; },
  };
}

test('generic list view paginates every item, numbers globally, and accepts a prefix', () => {
  const tracks = makeTracks(23);
  const first = buildListEmbed({ title: 'All tracks', items: tracks, page: 0, formatItem: (track) => track.title }).toJSON();
  const last = buildListEmbed({ title: 'All tracks', items: tracks, page: 2, formatItem: (track) => track.title }).toJSON();
  assert.match(first.description, /`1\./);
  assert.match(last.description, /`21\./);
  assert.match(last.description, /`23\./);
  assert.match(last.title, /page 3\/3/);
  const rows = buildListRows({ prefix: 'history', page: 0, pages: 3 });
  assert.equal(rows[0].toJSON().components[0].custom_id, 'history:first');
  assert.equal(buildListRows({ prefix: 'history', page: 0, pages: 1 }).length, 0);
  assert.ok(buildListRows({ prefix: 'history', page: 0, pages: 3, disabled: true })[0].toJSON().components.every((button) => button.disabled));
  assert.ok(first.description.length <= 4096);
});

test('list collector rejects other users, updates requested page, and disables on expiry', async () => {
  const interaction = fakeInteraction();
  await showPaginatedList(interaction, { title: 'Playlist', items: makeTracks(23), prefix: 'playlist-show', formatItem: (track) => track.title });
  const wrong = component('other', 'playlist-show:next');
  await interaction.collector.listeners('collect')[0](wrong);
  assert.equal(wrong.replyPayload.ephemeral, true);
  const next = component('owner', 'playlist-show:next');
  await interaction.collector.listeners('collect')[0](next);
  assert.match(next.updated.embeds[0].data.title, /page 2\/3/);
  interaction.collector.stop('time');
  const final = interaction.calls.at(-1)[1];
  assert.ok(final.components[0].toJSON().components.every((button) => button.disabled));
});

test('real /playlist show command paginates all tracks with requester guard and expiry', async () => {
  const musicPath = require.resolve('../src/music/player');
  const storePath = require.resolve('../src/music/playlist-store');
  const priorMusic = require.cache[musicPath];
  const priorStore = require.cache[storePath];
  require.cache[musicPath] = { id: musicPath, filename: musicPath, loaded: true, exports: {} };
  require.cache[storePath] = { id: storePath, filename: storePath, loaded: true, exports: { get: () => makeTracks(23) } };
  delete require.cache[require.resolve('../src/commands/playlist')];
  try {
    const command = require('../src/commands/playlist');
    const interaction = fakeInteraction();
    interaction.options = { getSubcommand: () => 'show', getString: () => 'Road trip' };
    await command.execute(interaction);
    assert.match(interaction.calls[0][1].embeds[0].data.description, /`1\./);
    const wrong = component('other', 'playlist-show:next');
    await interaction.collector.listeners('collect')[0](wrong);
    assert.equal(wrong.replyPayload.ephemeral, true);
    const next = component('owner', 'playlist-show:next');
    await interaction.collector.listeners('collect')[0](next);
    assert.match(next.updated.embeds[0].data.description, /`11\./);
    interaction.collector.stop('time');
    assert.ok(interaction.calls.at(-1)[1].components[0].toJSON().components.every((button) => button.disabled));
  } finally {
    if (priorMusic) require.cache[musicPath] = priorMusic; else delete require.cache[musicPath];
    if (priorStore) require.cache[storePath] = priorStore; else delete require.cache[storePath];
    delete require.cache[require.resolve('../src/commands/playlist')];
  }
});

test('real /history command uses the shared paginated list', async () => {
  const musicPath = require.resolve('../src/music/player');
  const priorMusic = require.cache[musicPath];
  require.cache[musicPath] = { id: musicPath, filename: musicPath, loaded: true, exports: { getQueue: () => ({ history: makeTracks(21) }) } };
  delete require.cache[require.resolve('../src/commands/history')];
  try {
    const command = require('../src/commands/history');
    const interaction = fakeInteraction();
    interaction.guildId = 'guild';
    await command.execute(interaction);
    assert.match(interaction.calls[0][1].embeds[0].data.title, /page 1\/3/);
    assert.equal(interaction.calls[0][1].ephemeral, true);
  } finally {
    if (priorMusic) require.cache[musicPath] = priorMusic; else delete require.cache[musicPath];
    delete require.cache[require.resolve('../src/commands/history')];
  }
});

test('real /lyrics command edits deferred ephemeral reply and paginates through shared collector', async () => {
  const musicPath = require.resolve('../src/music/player');
  const lyricsPath = require.resolve('../src/music/lyrics');
  const priorMusic = require.cache[musicPath];
  const priorLyrics = require.cache[lyricsPath];
  require.cache[musicPath] = { id: musicPath, filename: musicPath, loaded: true, exports: { getQueue: () => null } };
  require.cache[lyricsPath] = { id: lyricsPath, filename: lyricsPath, loaded: true, exports: {
    lookupLyrics: async () => ({ plainLyrics: 'line one\nline two', syncedLyrics: null }),
    splitLyrics: () => ['line one', 'line two'], cleanTitle: (title) => title,
  } };
  delete require.cache[require.resolve('../src/commands/lyrics')];
  try {
    const command = require('../src/commands/lyrics');
    const interaction = fakeInteraction();
    interaction.options = { getString: () => 'Song', getBoolean: () => null };
    await command.execute(interaction);
    assert.equal(interaction.calls[0][0], 'deferReply');
    assert.equal(interaction.calls[0][1].ephemeral, true);
    assert.equal(interaction.calls[1][0], 'editReply');
    assert.equal(interaction.calls[1][1].components[0].toJSON().components[0].custom_id, 'lyrics:first');
    const next = component('owner', 'lyrics:next');
    await interaction.collector.listeners('collect')[0](next);
    assert.equal(next.updated.embeds[0].data.description, 'line two');
  } finally {
    if (priorMusic) require.cache[musicPath] = priorMusic; else delete require.cache[musicPath];
    if (priorLyrics) require.cache[lyricsPath] = priorLyrics; else delete require.cache[lyricsPath];
    delete require.cache[require.resolve('../src/commands/lyrics')];
  }
});

test('list view can update an already deferred interaction reply', async () => {
  const interaction = fakeInteraction();
  await showPaginatedList(interaction, { title: 'Lyrics', items: ['line'], prefix: 'lyrics', numbered: false, editInitial: true });
  assert.equal(interaction.calls[0][0], 'editReply');
  assert.equal(interaction.calls[0][1].ephemeral, undefined);
});

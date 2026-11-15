const test = require('node:test');
const assert = require('node:assert/strict');
const { buildQueueEmbed, buildQueueRows, buildQueueActionRows, PER_PAGE } = require('../src/music/queue-view');
const { buildSearchEmbed, buildSearchRows, RESULT_COUNT } = require('../src/music/search-view');
const { buildCollectionEmbed, buildCollectionRows } = require('../src/music/collection-view');
const { showQueue } = require('../src/music/queue-view');

const makeTracks = (n, extra = {}) => Array.from({ length: n }, (_, k) => ({
  title: `Track ${k + 1} [Official] ${'x'.repeat(120)}`, url: `https://www.youtube.com/watch?v=id${k}`, duration: 200, author: 'Artist', ...extra,
}));
const ids = (rows) => rows.flatMap((row) => row.toJSON().components.map((c) => c.custom_id));
const labels = (rows) => rows.flatMap((row) => row.toJSON().components.map((c) => c.label));

test('queue embed lists every page with global numbering and stays inside Discord limits', () => {
  const tracks = makeTracks(95);
  const page3 = buildQueueEmbed({ current: tracks[0], tracks, page: 2, elapsed: 30, loop: 'queue', autoplay: true }).toJSON();
  assert.match(page3.description, /`21\.`/);
  assert.match(page3.description, /`30\.`/);
  assert.doesNotMatch(page3.description, /`31\.`/);
  assert.match(page3.description, /page 3\/10/);
  assert.match(page3.footer.text, /95 queued/);
  assert.match(page3.footer.text, /Loop: queue/);
  assert.ok(page3.description.length < 4096);
  const last = buildQueueEmbed({ current: tracks[0], tracks, page: 99 }).toJSON();
  assert.match(last.description, /`91\.`/);
  assert.match(last.description, /`95\.`/);
});

test('queue embed handles empty and single-page queues', () => {
  const empty = buildQueueEmbed({ current: null, tracks: [] }).toJSON();
  assert.match(empty.description, /Nothing is playing/);
  assert.match(empty.description, /Nothing queued/);
  assert.deepEqual(buildQueueRows(0, 1), []);
  assert.equal(PER_PAGE, 10);
});

test('queue actions offer only current-page tracks and fit Discord component limits', () => {
  const tracks = makeTracks(25);
  const rows = buildQueueActionRows({ page: 1, tracks, loop: 'queue', autoplay: true });
  assert.equal(rows.length, 3);
  const select = rows[0].toJSON().components[0];
  assert.equal(select.custom_id, 'queue:select');
  assert.equal(select.options.length, 10);
  assert.equal(select.options[0].value, '11');
  assert.equal(select.options.at(-1).value, '20');
  assert.deepEqual(ids(rows.slice(1)), ['queue:track:remove', 'queue:track:play', 'queue:track:top', 'queue:action:shuffle', 'queue:action:clear', 'queue:action:loop', 'queue:action:autoplay']);
  assert.ok(rows.every((row) => row.toJSON().components.length <= 5));
  assert.ok(buildQueueActionRows({ page: 0, tracks, disabled: true }).every((row) => row.toJSON().components.every((item) => item.disabled)));
});

test('queue collector simulates page-scoped selection, DJ denial, mutation, and live re-render', async () => {
  const playerPath = require.resolve('../src/music/player');
  const storePath = require.resolve('../src/store');
  const priorPlayer = require.cache[playerPath];
  const priorStore = require.cache[storePath];
  const tracks = makeTracks(25);
  let currentSettings = { djRole: 'dj', autoplay: false };
  const q = {
    current: makeTracks(1)[0], tracks, loop: 'off', autoplay: false, voiceChannelId: 'voice',
    getElapsedSeconds: () => 0, remove(position) { return this.tracks.splice(position - 1, 1)[0]; },
    shuffle() {}, clearQueue() { this.tracks.length = 0; }, skipTo() {}, move() {},
  };
  require.cache[playerPath] = { id: playerPath, filename: playerPath, loaded: true, exports: { getQueue: () => q } };
  require.cache[storePath] = { id: storePath, filename: storePath, loaded: true, exports: { get: () => currentSettings, set() {} } };
  try {
    const collector = new (require('node:events').EventEmitter)();
    const interaction = {
      guildId: 'guild', user: { id: 'requester' }, calls: [], collector,
      async reply(payload) { this.calls.push(payload); },
      async fetchReply() { return { createMessageComponentCollector: () => collector }; },
      async editReply(payload) { this.calls.push(payload); },
    };
    await showQueue(interaction, { ephemeral: true });
    const firstComponents = interaction.calls[0].components;
    const select = firstComponents.find((row) => row.toJSON().components[0].type === 3).toJSON().components[0];
    assert.equal(select.options.length, 10);
    assert.equal(select.options[0].value, '1');
    const makeComponent = (customId, member, values = []) => ({
      customId, member, user: { id: 'clicker' }, channelId: 'music', values,
      async deferUpdate() { this.deferred = true; }, async followUp(payload) { this.followed = payload; },
    });
    const handlers = collector.listeners('collect');
    await handlers[0](makeComponent('queue:next', {}, []));
    const pagePayload = interaction.calls.at(-1);
    const pageSelect = pagePayload.components.find((row) => row.toJSON().components[0].type === 3).toJSON().components[0];
    assert.equal(pageSelect.options[0].value, '11');
    const clicker = { roles: { cache: { has: () => false } }, permissions: { has: () => false }, voice: { channelId: 'voice' } };
    await handlers[0](makeComponent('queue:select', clicker, ['11']));
    const denied = makeComponent('queue:track:remove', clicker);
    await handlers[0](denied);
    assert.match(denied.followed.content, /DJ role/);
    assert.equal(q.tracks.length, 25);
    currentSettings = { djRole: null };
    const allowed = makeComponent('queue:track:remove', { voice: { channelId: 'voice' } });
    await handlers[0](allowed);
    assert.equal(q.tracks.length, 24, allowed.followed?.content || 'remove action should execute');
    assert.match(interaction.calls.at(-1).embeds[0].data.description, /`11\.` \[Track 12/);
    assert.doesNotMatch(interaction.calls.at(-1).embeds[0].data.description, /watch\?v=id10/);
  } finally {
    if (priorPlayer) require.cache[playerPath] = priorPlayer; else delete require.cache[playerPath];
    if (priorStore) require.cache[storePath] = priorStore; else delete require.cache[storePath];
  }
});

test('queue nav buttons disable at the edges and show the page counter', () => {
  const first = buildQueueRows(0, 5)[0].toJSON().components;
  assert.deepEqual(first.map((c) => c.disabled), [true, true, true, false, false]);
  assert.equal(first[2].label, '1 / 5');
  const last = buildQueueRows(4, 5)[0].toJSON().components;
  assert.deepEqual(last.map((c) => c.disabled), [false, false, true, true, true]);
  assert.ok(buildQueueRows(2, 5, true)[0].toJSON().components.every((c) => c.disabled));
});

test('search shows 8 numbered results with number buttons, paging, Queue all, and cancel', () => {
  assert.equal(RESULT_COUNT, 8);
  const embed = buildSearchEmbed('adele hello', makeTracks(8)).toJSON();
  for (let n = 1; n <= 8; n++) assert.match(embed.description, new RegExp(`\\*\\*${n}\\.\\*\\*`));
  assert.ok(embed.description.length < 4096);
  const rows = buildSearchRows(8);
  assert.equal(rows.length, 3);
  assert.deepEqual(labels(rows.slice(0, 2)), ['1', '2', '3', '4', '5', '6', '7', '8']);
  assert.deepEqual(rows.slice(0, 2).map((r) => r.toJSON().components.length), [4, 4]);
  assert.deepEqual(ids(rows.slice(2)), ['search:previous', 'search:page:1', 'search:next', 'search:queue', 'search:cancel']);
  const secondPage = buildSearchRows(8, { page: 1, hasNext: true });
  assert.deepEqual(labels(secondPage.slice(0, 2)), ['9', '10', '11', '12', '13', '14', '15', '16']);
  assert.deepEqual(ids(secondPage.slice(2)), ['search:previous', 'search:page:2', 'search:next', 'search:queue', 'search:cancel']);
  assert.deepEqual(ids(buildSearchRows(3)), ['search:0', 'search:1', 'search:2', 'search:previous', 'search:page:1', 'search:next', 'search:queue', 'search:cancel']);
  assert.ok(buildSearchRows(8, { disabled: true }).every((r) => r.toJSON().components.every((c) => c.disabled)));
});

test('playlist prompt: stats line, clean preview, source label and one tidy row of actions + a drop-down', () => {
  const tracks = [
    { title: 'sombr - back to friends', url: 'https://youtu.be/a1', duration: 200, source: 'youtube', playlistTitle: 'ma songs' },
    { title: 'The Police - Every Breath You Take (Lyrics) #fyp', url: 'https://youtu.be/a2', duration: 229, source: 'youtube' },
    ...makeTracks(50),
  ];
  const embed = buildCollectionEmbed(tracks).toJSON();
  assert.equal(embed.title, 'ma songs');
  assert.equal(embed.author.name, '📃 YouTube playlist');
  assert.match(embed.description, /🎵 \*\*52\*\* tracks {2}· {2}⏱ \*\*/);
  assert.match(embed.description, /avg \d+:\d{2}/);
  assert.match(embed.description, /\*\*2\.\*\* The Police - Every Breath You Take · 3:49/, 'noise like (Lyrics) and #hashtags removed');
  assert.doesNotMatch(embed.description, /Lyrics|#fyp/);
  assert.equal(embed.description.split('\n').filter((l) => /^\*\*\d+\.\*\*/.test(l)).length, 6);
  assert.match(embed.description, /…and 46 more/);
  assert.equal(buildCollectionEmbed(tracks, { kind: 'Saved' }).toJSON().author.name, '📃 Saved playlist');
  assert.equal(buildCollectionEmbed([{ title: 'x', source: 'spotify', spotifyQuery: 'q' }, ...tracks]).toJSON().author.name, '📃 Spotify playlist');

  const rows = buildCollectionRows();
  assert.equal(rows.length, 2);
  const main = rows[0].toJSON().components;
  assert.deepEqual(main.map((b) => b.custom_id), ['collection:order', 'collection:shuffle', 'collection:dedupe', 'collection:save', 'collection:cancel']);
  assert.deepEqual(main.map((b) => b.style), [3, 1, 2, 2, 4], 'green play, blurple shuffle, grey toggle/save, red cancel');
  assert.ok(main.every((b) => b.emoji && b.label.length <= 16), 'short labels with icons');
  const menu = rows[1].toJSON().components[0];
  assert.equal(menu.custom_id, 'collection:more');
  assert.deepEqual(menu.options.map((o) => o.value), ['first', 'firstn', 'next', 'shufflenext']);
  assert.ok(menu.options.every((o) => o.label && o.description && o.emoji));

  const dedupe = (on) => buildCollectionRows({ skipDuplicates: on })[0].toJSON().components.find((b) => b.custom_id === 'collection:dedupe');
  assert.equal(dedupe(false).style, 2);
  assert.equal(dedupe(true).style, 3);
  assert.match(dedupe(true).label, /No duplicates/);
  assert.equal(buildCollectionRows({ allowSave: false })[0].toJSON().components.some((b) => b.custom_id === 'collection:save'), false);
  const saved = buildCollectionRows({ saved: true })[0].toJSON().components.find((b) => b.custom_id === 'collection:save');
  assert.ok(saved.disabled && saved.label === 'Saved');
  assert.ok(buildCollectionRows({ disabled: true }).every((row) => row.toJSON().components.every((c) => c.disabled)));
});

test('playlist prompt warns about the queue limit and the truncated 200-track load', () => {
  assert.match(buildCollectionEmbed(makeTracks(200)).toJSON().footer.text, /first 200 tracks/);
  const tight = buildCollectionEmbed(makeTracks(30), { room: 12 }).toJSON().description;
  assert.match(tight, /room for \*\*12\*\* more tracks; only the first 12/);
  assert.match(buildCollectionEmbed(makeTracks(30), { room: 0 }).toJSON().description, /queue is full/);
  assert.doesNotMatch(buildCollectionEmbed(makeTracks(30), { room: 500 }).toJSON().description, /⚠️/);
  assert.doesNotMatch(buildCollectionEmbed(makeTracks(30), { room: 5, expired: true }).toJSON().description, /⚠️/);
  const huge = buildCollectionEmbed(makeTracks(200).map((t) => ({ ...t, title: 'é'.repeat(300) })), { title: 'x'.repeat(400) }).toJSON();
  assert.ok(huge.title.length <= 256 && huge.description.length <= 4096);
});

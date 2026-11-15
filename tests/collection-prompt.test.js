// Drives the REAL playlist prompt with fake interactions (no Discord, no audio, no disk).
const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const { PassThrough } = require('node:stream');

const storePath = require.resolve('../src/store');
let settings = { volume: 100, filterPresets: [], cleanupNowPlaying: 'edit', maxQueueLength: 500, maxTrackDuration: 10800 };
require.cache[storePath] = { id: storePath, filename: storePath, loaded: true, exports: { get: () => settings, set: (_g, p) => { settings = { ...settings, ...p }; return settings; } } };
require('../src/music/queue-store').createQueueStore = () => ({ delete() {}, set() {}, entries: () => [], flush: async () => {}, load: async () => {} });
const playlistStore = require('../src/music/playlist-store');
const saved = {};
playlistStore.list = (u) => Object.keys(saved[u] || {});
playlistStore.create = (u, n) => { (saved[u] = saved[u] || {})[n] = []; };
playlistStore.add = (u, n, t) => { saved[u][n].push(...t); };
playlistStore.delete = (u, n) => { delete saved[u][n]; };
require('../src/music/sources/youtube').stream = async () => ({ stream: new PassThrough(), kill() {} });
const music = require('../src/music/player');
const { promptCollection } = require('../src/commands/_collection-prompt');

const vc = { id: 'v1', members: { filter: () => ({ size: 1 }) }, guild: { voiceAdapterCreator: () => ({ sendPayload: () => true, destroy() {} }) } };
const guild = { members: { me: { voice: { channelId: null } } } };
const sent = { send: async () => ({ edit: async () => {}, delete: async () => {} }) };
const makeTracks = (n, prefix = 'Song') => Array.from({ length: n }, (_, k) => ({ title: `${prefix} ${k + 1}`, url: `https://www.youtube.com/watch?v=${prefix}${String(k).padStart(6, '0')}`, duration: 180, source: 'youtube' }));
const wait = (ms = 25) => new Promise((resolve) => setTimeout(resolve, ms));
const text = (payload) => payload?.embeds?.[0]?.toJSON?.().description || payload?.content || '';

function start(tracks, options) {
  const log = [];
  let collector;
  const message = { edit: async () => {}, delete: async () => {}, createMessageComponentCollector: () => { collector = Object.assign(new EventEmitter(), { stop(reason) { this.emit('end', [], reason); } }); return collector; } };
  const i = {
    guildId: 'g', guild, channel: sent, user: { id: 'u1' }, member: { displayName: 'Tester', voice: { channel: vc } },
    editReply: async (o) => { log.push(['edit', o]); }, fetchReply: async () => message,
  };
  return { i, log, ready: promptCollection(i, tracks, options), collector: () => collector };
}
function component(customId, { user = 'u1', modal, values } = {}) {
  const out = [];
  const c = {
    customId, values, user: { id: user }, guild, guildId: 'g', channel: sent, deferred: false, replied: false,
    member: { displayName: user === 'u1' ? 'Tester' : 'Other', voice: { channel: vc } },
    update: async (o) => { out.push(['update', o]); }, reply: async (o) => { c.replied = true; out.push(['reply', o]); },
    deferUpdate: async () => { c.deferred = true; }, editReply: async (o) => { out.push(['edit', o]); },
    followUp: async (o) => { out.push(['followUp', o]); }, fetchReply: async () => ({ edit: async () => {}, delete: async () => {} }),
    showModal: async () => { out.push(['modal']); },
    awaitModalSubmit: async () => modal,
  };
  return { c, out };
}
const fire = async (ctx, c) => { ctx.collector().emit('collect', c); await wait(); };
const reset = () => { music.getQueue('g')?.destroy(); };

test('First N modal queues only the first N tracks in order, and rejects bad input', async () => {
  reset();
  const tracks = makeTracks(20);
  const ctx = start(tracks);
  await ctx.ready;
  const bad = component('collection:modal-sub');
  bad.c.fields = { getTextInputValue: () => 'abc' };
  const badClick = component('collection:more', { values: ['firstn'], modal: { ...bad.c, customId: 'collection:modal', user: { id: 'u1' }, fields: { getTextInputValue: () => 'abc' }, reply: async (o) => bad.out.push(['reply', o]) } });
  await fire(ctx, badClick.c);
  assert.equal(badClick.out[0][0], 'modal');
  assert.match(text(bad.out[0][1]), /whole number from 1 to 20/);
  assert.equal(music.getQueue('g'), undefined, 'bad input must not queue anything');

  const modalOut = [];
  const modal = {
    customId: 'collection:modal', user: { id: 'u1' }, guild, guildId: 'g', channel: sent, member: { displayName: 'Tester', voice: { channel: vc } },
    fields: { getTextInputValue: () => '5' }, deferUpdate: async () => {}, reply: async (o) => modalOut.push(['reply', o]),
    editReply: async (o) => { modalOut.push(['edit', o]); }, fetchReply: async () => ({ edit: async () => {} }),
  };
  await fire(ctx, component('collection:more', { values: ['firstn'], modal }).c);
  const q = music.getQueue('g');
  assert.deepEqual([q.current.title, ...q.tracks.map((t) => t.title)], ['Song 1', 'Song 2', 'Song 3', 'Song 4', 'Song 5']);
  assert.match(modalOut.at(-1)[1].embeds[0].toJSON().footer.text, /first 5/);
  reset();
});

test('Shuffle & next puts a shuffled copy at the front of an existing queue', async () => {
  reset();
  const q = music.getOrCreate('g', vc, sent);
  q.enqueue(makeTracks(3, 'Old'));
  await wait();
  const tracks = makeTracks(12, 'New');
  const ctx = start(tracks);
  await ctx.ready;
  await fire(ctx, component('collection:more', { values: ['shufflenext'] }).c);
  assert.equal(q.tracks.length, 2 + 12);
  const front = q.tracks.slice(0, 12).map((t) => t.title);
  assert.deepEqual([...front].sort(), tracks.map((t) => t.title).sort());
  assert.notDeepEqual(front, tracks.map((t) => t.title), 'should be shuffled');
  assert.deepEqual(q.tracks.slice(12).map((t) => t.title), ['Old 2', 'Old 3']);
  reset();
});

test('Skip duplicates toggles on the buttons and filters what is already queued or playing', async () => {
  reset();
  const q = music.getOrCreate('g', vc, sent);
  const incoming = makeTracks(6, 'Mix');
  q.enqueue([{ ...incoming[0] }, { ...incoming[2] }, { ...makeTracks(1, 'Other')[0] }]);
  await wait();
  const ctx = start(incoming);
  await ctx.ready;
  const toggle = component('collection:dedupe');
  await fire(ctx, toggle.c);
  const dedupeButton = toggle.out[0][1].components[0].toJSON().components.find((b) => b.custom_id === 'collection:dedupe');
  assert.equal(dedupeButton.style, 3);
  const before = q.tracks.length;
  const click = component('collection:order');
  await fire(ctx, click.c);
  assert.equal(q.tracks.length, before + 4, 'two of the six were already queued/playing');
  assert.match(click.out.at(-1)[1].embeds[0].toJSON().footer.text, /skipped 2 duplicates/);
  reset();
});

test('Skip duplicates with nothing new answers privately and keeps the prompt open', async () => {
  reset();
  const q = music.getOrCreate('g', vc, sent);
  const same = makeTracks(3, 'Same');
  q.enqueue(same.map((t) => ({ ...t })));
  await wait();
  const ctx = start(same);
  await ctx.ready;
  await fire(ctx, component('collection:dedupe').c);
  const click = component('collection:shuffle');
  await fire(ctx, click.c);
  assert.equal(click.out[0][0], 'reply');
  assert.equal(click.out[0][1].ephemeral, true);
  assert.match(text(click.out[0][1]), /already in the queue/);
  assert.equal(q.tracks.length + 1, 3);
  reset();
});

test('prompt still blocks other users, saves once, and cancels', async () => {
  reset();
  const tracks = makeTracks(4);
  const ctx = start(tracks, { title: 'Road trip' });
  await ctx.ready;
  const stranger = component('collection:order', { user: 'u2' });
  await fire(ctx, stranger.c);
  assert.match(text(stranger.out[0][1]), /Only Tester/);
  assert.equal(music.getQueue('g'), undefined);
  await fire(ctx, component('collection:save').c);
  assert.equal(saved.u1['Road trip'].length, 4);
  const again = component('collection:save');
  await fire(ctx, again.c);
  assert.match(text(again.out[0][1]), /Already saved/);
  const cancel = component('collection:cancel');
  await fire(ctx, cancel.c);
  assert.match(text(cancel.out[0][1]), /Cancelled/);
  assert.equal(music.getQueue('g'), undefined);
});

test('prompt buttons are disabled after the collector times out', async () => {
  const ctx = start(makeTracks(3));
  await ctx.ready;
  ctx.collector().stop('time');
  await wait();
  const last = ctx.log.at(-1)[1];
  assert.ok(last.components.every((row) => row.toJSON().components.every((b) => b.disabled)));
});

test('drop-down options "First song only" and "Play next" work from the select menu', async () => {
  reset();
  const first = start(makeTracks(8));
  await first.ready;
  await fire(first, component('collection:more', { values: ['first'] }).c);
  const q = music.getQueue('g');
  assert.equal(q.current.title, 'Song 1');
  assert.equal(q.tracks.length, 0);
  reset();

  const q2 = music.getOrCreate('g', vc, sent);
  q2.enqueue(makeTracks(2, 'Old'));
  await wait();
  const next = start(makeTracks(3, 'New'));
  await next.ready;
  await fire(next, component('collection:more', { values: ['next'] }).c);
  assert.deepEqual(q2.tracks.map((t) => t.title), ['New 1', 'New 2', 'New 3', 'Old 2']);
  reset();
});

test('the queue limit trims what is added instead of failing the whole playlist', async () => {
  reset();
  const original = settings;
  settings = { ...settings, maxQueueLength: 10 };
  const q = music.getOrCreate('g', vc, sent);
  q.enqueue(makeTracks(3, 'Old'));
  await wait();
  const ctx = start(makeTracks(20, 'New'));
  await ctx.ready;
  const shown = ctx.log[0][1].embeds[0].toJSON().description;
  assert.match(shown, /room for \*\*7\*\* more tracks/, 'warned before choosing');
  const click = component('collection:order');
  await fire(ctx, click.c);
  assert.equal(q.tracks.length + 1, 10, 'queue filled up to the limit, not beyond');
  assert.match(click.out.at(-1)[1].embeds[0].toJSON().footer.text, /limited to 7 by the queue limit/);
  const second = start(makeTracks(5, 'More'));
  await second.ready;
  const full = component('collection:order');
  await fire(second, full.c);
  assert.equal(full.out[0][0], 'reply');
  assert.match(text(full.out[0][1]), /queue is full/);
  settings = original;
  reset();
});

test('tracks longer than the server limit are skipped with a note; all-too-long answers privately', async () => {
  reset();
  const original = settings;
  settings = { ...settings, maxTrackDuration: 300 };
  const tracks = [...makeTracks(3, 'Short'), { ...makeTracks(1, 'Huge')[0], duration: 7200 }, ...makeTracks(2, 'Brief')];
  const ctx = start(tracks);
  await ctx.ready;
  const click = component('collection:order');
  await fire(ctx, click.c);
  const q = music.getQueue('g');
  assert.equal(q.tracks.length + 1, 5, 'the 2-hour track was left out');
  assert.match(click.out.at(-1)[1].embeds[0].toJSON().footer.text, /skipped 1 over the length limit/);
  reset();

  const longOnly = start([{ ...makeTracks(1, 'A')[0], duration: 9000 }, { ...makeTracks(1, 'B')[0], duration: 9500 }]);
  await longOnly.ready;
  const denied = component('collection:order');
  await fire(longOnly, denied.c);
  assert.equal(denied.out[0][0], 'reply');
  assert.match(text(denied.out[0][1]), /longer than this server's 5-minute limit/);
  assert.equal(music.getQueue('g'), undefined);
  settings = original;
});

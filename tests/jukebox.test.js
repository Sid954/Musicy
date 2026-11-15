const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const { PassThrough } = require('node:stream');

// ---- stubs (before anything loads the real store / queue store / audio) ----
const storePath = require.resolve('../src/store');
let settings = { volume: 100, filterPresets: [], cleanupNowPlaying: 'edit', maxQueueLength: 500, maxTrackDuration: 10800, djRole: null, textChannel: null, jukebox: null };
const saved = {};
require.cache[storePath] = { id: storePath, filename: storePath, loaded: true, exports: { get: () => settings, set: (_g, patch) => { Object.assign(saved, patch); settings = { ...settings, ...patch }; return settings; } } };
require('../src/music/queue-store').createQueueStore = () => ({ delete() {}, set() {}, entries: () => [], flush: async () => {}, load: async () => {} });
require('../src/music/sources/youtube').stream = async () => ({ stream: new PassThrough(), kill() {} });
const music = require('../src/music/player');
const { buildJukeboxCard, buildJukeboxEmbed, buildJukeboxRows } = require('../src/music/jukebox-view');
const { createJukebox } = require('../src/music/jukebox');
const { handleJukeboxButton } = require('../src/jukebox-controls');

const comps = (rows) => rows.flatMap((row) => row.toJSON().components);
const wait = (ms = 25) => new Promise((resolve) => setTimeout(resolve, ms));
const song = { title: 'Sami Yusuf - Make Me Strong #worldmusic', url: 'https://youtu.be/abc', duration: 237, author: 'Sami Yusuf', requestedBy: 'Sid' };

test('idle card invites a request; active card shows the track, queue size and enabled controls', () => {
  const idle = buildJukeboxCard(null);
  assert.match(idle.embed.toJSON().description, /Press \*\*Add song\*\*/);
  const idleButtons = comps(idle.rows);
  assert.deepEqual(idleButtons.map((b) => b.custom_id), ['jb:add', 'jb:pause', 'jb:skip', 'jb:stop', 'jb:queue']);
  assert.deepEqual(idleButtons.map((b) => b.disabled), [false, true, true, true, false]);
  const active = buildJukeboxCard({ track: song, elapsed: 30, queuedCount: 3 });
  assert.equal(active.embed.toJSON().title, 'Sami Yusuf - Make Me Strong');
  assert.equal(active.embed.toJSON().footer.text, '3 more in the queue');
  assert.deepEqual(comps(active.rows).map((b) => b.disabled), [false, false, false, false, false]);
  assert.equal(buildJukeboxEmbed({ track: song, queuedCount: 0 }).toJSON().footer.text, 'Queue is empty — add a song!');
  assert.equal(comps(buildJukeboxRows({ active: true, paused: true }))[1].emoji.name, '▶️');
  assert.ok(comps(buildJukeboxRows({ disabled: true })).every((b) => b.disabled));
});

// ---- controller ----
function fakeWorld({ messageFound = true } = {}) {
  const edits = [];
  const message = { id: 'm1', edit: async (payload) => { edits.push(payload.embeds[0].toJSON()); } };
  const channel = { messages: { fetch: async () => { if (!messageFound) throw new Error('Unknown Message'); return message; } } };
  const client = { channels: { cache: new Map([['c1', channel]]), fetch: async () => channel } };
  return { edits, client };
}

test('controller edits once, coalesces rapid updates to the newest state, and respects the interval', async () => {
  let clock = 10_000;
  const timers = [];
  const cfg = { jukebox: { channelId: 'c1', messageId: 'm1' } };
  const box = createJukebox({ getSettings: () => cfg, setSettings: () => {}, minIntervalMs: 2000, now: () => clock, schedule: (fn, ms) => { timers.push({ fn, ms }); return { unref() {} }; } });
  const { edits, client } = fakeWorld();
  await box.update(client, 'g', { track: { ...song, title: 'One' }, queuedCount: 0 });
  assert.equal(edits.length, 1);
  clock += 500;
  await box.update(client, 'g', { track: { ...song, title: 'Two' }, queuedCount: 0 });
  await box.update(client, 'g', { track: { ...song, title: 'Three' }, queuedCount: 0 });
  assert.equal(edits.length, 1, 'inside the interval: nothing sent yet');
  assert.equal(timers.length, 1, 'one timer for any number of pending updates');
  assert.equal(timers[0].ms, 1500);
  clock += 1500;
  timers[0].fn();
  await wait();
  assert.equal(edits.length, 2);
  assert.equal(edits[1].title, 'Three', 'newest state wins');
  await box.update(client, 'g', null);
  assert.equal(edits.length, 2, 'throttled again');
});

test('controller ignores servers without a player and forgets a deleted player message', async () => {
  const none = createJukebox({ getSettings: () => ({}), setSettings: () => {} });
  const world = fakeWorld();
  assert.equal(await none.update(world.client, 'g', null), false);
  assert.equal(await none.update(null, 'g', null), false);
  let patch = null;
  const gone = createJukebox({ getSettings: () => ({ jukebox: { channelId: 'c1', messageId: 'm1' } }), setSettings: (_g, p) => { patch = p; } });
  assert.equal(await gone.update(fakeWorld({ messageFound: false }).client, 'g', null), false);
  assert.deepEqual(patch, { jukebox: null }, 'config cleared so we stop retrying');
});

// ---- router: "Add song" modal and reused controls ----
const vc = { id: 'v1', members: { filter: () => ({ size: 1 }) }, guild: { voiceAdapterCreator: () => ({ sendPayload: () => true, destroy() {} }) } };
const guild = { members: { me: { voice: { channelId: null } } } };
const text = (payload) => payload?.embeds?.[0]?.toJSON?.().description || payload?.content || '';

function buttonClick(customId, { inVoice = true, modal, userId = 'u1' } = {}) {
  const log = [];
  const i = {
    customId, guildId: 'jg', channelId: 'jukebox-channel', guild, channel: { id: 'jukebox-channel', send: async () => ({ edit: async () => {}, delete: async () => {} }) },
    user: { id: userId }, deferred: false, replied: false,
    member: { displayName: 'Tester', voice: inVoice ? { channelId: 'v1', channel: vc } : { channelId: null, channel: null }, permissions: { has: () => false }, roles: { cache: { has: () => false, keys: () => [][Symbol.iterator]() } } },
    reply: async (o) => { i.replied = true; log.push(['reply', o]); },
    showModal: async () => { log.push(['modal']); },
    awaitModalSubmit: async () => modal,
  };
  return { i, log };
}
function modalSubmit(query) {
  const log = [];
  return {
    log,
    submitted: {
      customId: 'jb:modal', user: { id: 'u1' }, guildId: 'jg', member: { displayName: 'Tester' }, channel: { id: 'jukebox-channel', send: async () => ({ edit: async () => {} }) },
      fields: { getTextInputValue: () => query },
      deferReply: async () => { log.push(['defer']); },
      editReply: async (o) => { log.push(['edit', o]); },
    },
  };
}

test('Add song: needs a voice channel, then asks via modal and queues the request privately', async () => {
  music.getQueue('jg')?.destroy();
  const lonely = buttonClick('jb:add', { inVoice: false });
  await handleJukeboxButton(lonely.i);
  assert.match(text(lonely.log[0][1]), /Join a voice channel first/);

  music.resolve = async (query) => [{ title: `Result for ${query}`, url: 'https://www.youtube.com/watch?v=req0000001', duration: 100, source: 'youtube' }];
  const m = modalSubmit('adele hello');
  const click = buttonClick('jb:add', { modal: m.submitted, userId: 'rate-1' });
  await handleJukeboxButton(click.i);
  assert.equal(click.log[0][0], 'modal');
  assert.deepEqual(m.log.map((l) => l[0]), ['defer', 'edit']);
  assert.match(text(m.log[1][1]), /Now playing \*\*Result for adele hello\*\*/);
  const q = music.getQueue('jg');
  assert.equal(q.current.title, 'Result for adele hello');
  assert.equal(q.current.requestedBy, 'Tester');

  const second = modalSubmit('another');
  await handleJukeboxButton(buttonClick('jb:add', { modal: second.submitted, userId: 'rate-2' }).i);
  assert.match(text(second.log[1][1]), /Queued \*\*Result for another\*\* at position 1/);

  const empty = modalSubmit('   ');
  await handleJukeboxButton(buttonClick('jb:add', { modal: empty.submitted, userId: 'rate-3' }).i);
  assert.match(text(empty.log[1][1]), /Type a song name/);

  const spam = buttonClick('jb:add', { userId: 'rate-1' });
  await handleJukeboxButton(spam.i);
  assert.match(text(spam.log[0][1]), /Please wait/, 'per-user cooldown');
  q.destroy();
});

test('Add song accepts a closed modal quietly and caps playlist requests at 50 tracks', async () => {
  music.getQueue('jg')?.destroy();
  const dismissed = buttonClick('jb:add', { modal: null, userId: 'rate-4' });
  await handleJukeboxButton(dismissed.i);
  assert.equal(dismissed.log.length, 1, 'only the modal was shown');
  music.resolve = async () => Array.from({ length: 80 }, (_, k) => ({ title: `T${k}`, url: `https://www.youtube.com/watch?v=big${String(k).padStart(7, '0')}`, duration: 60, source: 'youtube' }));
  const m = modalSubmit('big playlist');
  await handleJukeboxButton(buttonClick('jb:add', { modal: m.submitted, userId: 'rate-5' }).i);
  assert.match(text(m.log[1][1]), /Added \*\*50 tracks\*\*/);
  assert.equal(music.getQueue('jg').tracks.length + 1, 50);
  music.getQueue('jg').destroy();
});

test('jb pause/skip/stop/queue reuse the np controls (voice + DJ checks) and work outside the commands channel', async () => {
  music.getQueue('jg')?.destroy();
  settings = { ...settings, textChannel: 'commands-only' };
  const q = music.getOrCreate('jg', vc, { id: 'x', send: async () => ({ edit: async () => {}, delete: async () => {} }) });
  q.enqueue([{ title: 'A', url: 'https://www.youtube.com/watch?v=aaaaaaa001', duration: 100, source: 'youtube', requestedById: 'u1' }, { title: 'B', url: 'https://www.youtube.com/watch?v=bbbbbbb002', duration: 100, source: 'youtube' }]);
  await wait();
  guild.members.me.voice.channelId = 'v1';
  const pause = buttonClick('jb:pause');
  await handleJukeboxButton(pause.i);
  assert.match(text(pause.log[0][1]), /Paused/);
  const away = buttonClick('jb:skip', { inVoice: false });
  await handleJukeboxButton(away.i);
  assert.match(text(away.log[0][1]), /Join my voice channel/);
  settings = { ...settings, djRole: 'dj' };
  const stop = buttonClick('jb:stop');
  await handleJukeboxButton(stop.i);
  assert.match(text(stop.log[0][1]), /DJ role|Manage Server/);
  assert.ok(music.getQueue('jg'), 'stop was denied');
  settings = { ...settings, djRole: null, textChannel: null };
  const unknown = buttonClick('jb:bogus');
  await handleJukeboxButton(unknown.i);
  assert.match(text(unknown.log[0][1]), /not available/);
  guild.members.me.voice.channelId = null;
  q.destroy();
});

// ---- real queue keeps the player message in sync and suppresses channel announcements ----
test('queue keeps the request-channel player message in sync; announcements are skipped in that channel', async () => {
  music.getQueue('kg')?.destroy();
  const edits = [];
  const message = { id: 'pm', edit: async (payload) => { edits.push(payload.embeds[0].toJSON()); } };
  const channel = { id: 'player-channel', messages: { fetch: async () => message } };
  const client = { channels: { cache: new Map([['player-channel', channel]]), fetch: async () => channel } };
  const voice = { ...vc, client };
  const sent = [];
  const textChannel = { id: 'player-channel', send: async (payload) => { sent.push(payload); return { edit: async () => {}, delete: async () => {} }; } };
  settings = { ...settings, jukebox: { channelId: 'player-channel', messageId: 'pm' } };
  const q = music.getOrCreate('kg', voice, textChannel);
  q.enqueue([{ title: 'Playing Now', url: 'https://www.youtube.com/watch?v=ppppppp001', duration: 100, source: 'youtube' }]);
  await wait(60);
  assert.equal(edits.length, 1);
  assert.equal(edits[0].title, 'Playing Now');
  assert.equal(sent.length, 0, 'no per-track announcement in the player channel');
  await new Promise((resolve) => setTimeout(resolve, 2100));
  q.stop();
  await new Promise((resolve) => setTimeout(resolve, 2300));
  assert.equal(edits.at(-1).title, '🎶 Music player', 'idle card after stop');
  q.destroy();
  settings = { ...settings, jukebox: null };
  const other = music.getOrCreate('kg', voice, { id: 'elsewhere', send: async (payload) => { sent.push(payload); return { edit: async () => {} }; } });
  other.enqueue([
    { title: 'Elsewhere', url: 'https://www.youtube.com/watch?v=eeeeeee001', duration: 100, source: 'youtube' },
    { title: 'Elsewhere 2', url: 'https://www.youtube.com/watch?v=eeeeeee002', duration: 100, source: 'youtube' },
  ]);
  await wait(60);
  other.skip(); // the second track is announced by the queue (the first one is announced by the command reply)
  await wait(60);
  assert.equal(sent.length, 1, 'announcements still happen outside a configured player channel');
  other.destroy();
});

test.after(() => { for (const id of ['jg', 'kg']) music.getQueue(id)?.destroy(); });

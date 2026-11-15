const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { extractPlayQuery, textToQuery, urlsIn, cleanUrl } = require('../src/music/message-query');

const attachment = (url, contentType) => ({ url, contentType, name: url.split('/').pop() });
const message = (over = {}) => ({ content: '', attachments: new Map(), embeds: [], ...over });
const attachments = (...items) => new Map(items.map((item, n) => [String(n), item]));

test('an audio attachment wins over everything else in the message', () => {
  const m = message({
    content: 'listen to this https://www.youtube.com/watch?v=abc123abc12',
    attachments: attachments(attachment('https://cdn.discordapp.com/attachments/1/2/pic.png', 'image/png'), attachment('https://cdn.discordapp.com/attachments/1/2/song.mp3?ex=1&hm=2', 'audio/mpeg')),
  });
  assert.deepEqual(extractPlayQuery(m), { query: 'https://cdn.discordapp.com/attachments/1/2/song.mp3?ex=1&hm=2', source: 'attachment' });
  const byExtension = message({ attachments: attachments(attachment('https://cdn.discordapp.com/attachments/1/2/track.FLAC?x=1', null)) });
  assert.equal(extractPlayQuery(byExtension).source, 'attachment');
  assert.equal(extractPlayQuery(message({ attachments: attachments(attachment('https://cdn.discordapp.com/a/b/pic.png', 'image/png')) })), null, 'a picture alone is not playable');
});

test('music links are preferred over other links, and punctuation around links is removed', () => {
  const m = message({ content: 'see https://example.com/article and also (https://open.spotify.com/track/abc123), thanks!' });
  assert.deepEqual(extractPlayQuery(m), { query: 'https://open.spotify.com/track/abc123', source: 'link' });
  assert.equal(extractPlayQuery(message({ content: '<https://youtu.be/dQw4w9WgXcQ>' })).query, 'https://youtu.be/dQw4w9WgXcQ');
  assert.equal(extractPlayQuery(message({ content: 'Try https://soundcloud.com/a/b.' })).query, 'https://soundcloud.com/a/b');
  assert.equal(extractPlayQuery(message({ content: 'only https://example.com/page' })).query, 'https://example.com/page', 'falls back to the first link');
  assert.deepEqual(urlsIn('x https://a.test/1, https://b.test/2) y'), ['https://a.test/1', 'https://b.test/2']);
  assert.equal(cleanUrl('https://x.test/a)'), 'https://x.test/a');
  assert.equal(cleanUrl(`https://x.test/${'a'.repeat(900)}`).length, 500);
});

test('link previews and bot messages: embed link first, then embed title', () => {
  const preview = message({ embeds: [{ url: 'https://www.youtube.com/watch?v=abc123abc12', title: 'A video' }] });
  assert.deepEqual(extractPlayQuery(preview), { query: 'https://www.youtube.com/watch?v=abc123abc12', source: 'embed' });
  const otherBot = message({ embeds: [{ title: 'Adele - Hello (Official Music Video)' }] });
  assert.deepEqual(extractPlayQuery(otherBot), { query: 'Adele - Hello (Official Music Video)', source: 'embed' });
  assert.equal(extractPlayQuery(message({ embeds: [{ url: 'javascript:alert(1)', title: 'safe title' }] })).query, 'safe title', 'non-http embed urls are never used');
});

test('plain text becomes a search query with mentions, emoji, markdown and code removed', () => {
  assert.deepEqual(extractPlayQuery(message({ content: '<@123456> play **Daft Punk - Get Lucky** pls <:pepe:987654321> ' })), { query: 'play Daft Punk - Get Lucky pls', source: 'text' });
  assert.equal(textToQuery('```js\nconsole.log(1)\n``` hello there'), 'hello there');
  assert.equal(textToQuery('   '), null);
  assert.equal(textToQuery('a'), null, 'too short to mean anything');
  assert.ok(textToQuery('x'.repeat(500)).length <= 200);
  assert.equal(textToQuery('look https://example.com/x here'), 'look here', 'links are never part of a text query');
});

test('nothing playable -> null (empty, mention-only, image-only, null message)', () => {
  assert.equal(extractPlayQuery(message()), null);
  assert.equal(extractPlayQuery(message({ content: '<@123> <#456> 🙂' })), null);
  assert.equal(extractPlayQuery(null), null);
  assert.equal(extractPlayQuery({}), null);
});

// ---- the real command with fake interactions ----
const storePath = require.resolve('../src/store');
require.cache[storePath] = { id: storePath, filename: storePath, loaded: true, exports: { get: () => ({ volume: 100, filterPresets: [], cleanupNowPlaying: 'edit', maxQueueLength: 500, maxTrackDuration: 10800 }), set: () => ({}) } };
require('../src/music/queue-store').createQueueStore = () => ({ delete() {}, set() {}, entries: () => [], flush: async () => {}, load: async () => {} });
require('../src/music/sources/youtube').stream = async () => ({ stream: new PassThrough(), kill() {} });
const music = require('../src/music/player');
const command = require('../src/commands/play-this');

const vc = { id: 'v1', members: { filter: () => ({ size: 1 }) }, guild: { voiceAdapterCreator: () => ({ sendPayload: () => true, destroy() {} }) } };
const sent = { id: 't', send: async () => ({ edit: async () => {}, delete: async () => {} }) };
const wait = (ms = 25) => new Promise((resolve) => setTimeout(resolve, ms));
const text = (payload) => payload?.embeds?.[0]?.toJSON?.().description || '';
const guild = { members: { me: { voice: { channelId: null } } }, channels: { cache: new Map() } };

function invoke(targetMessage, { inVoice = true } = {}) {
  const log = [];
  const i = {
    guildId: 'ctx-g', guild, channel: sent, user: { id: 'u1' }, targetMessage,
    member: { displayName: 'Tester', voice: { channel: inVoice ? vc : null } },
    deferred: false, replied: false,
    deferReply: async () => { i.deferred = true; log.push(['defer']); },
    reply: async (o) => { i.replied = true; log.push(['reply', o]); },
    editReply: async (o) => { log.push(['edit', o]); },
    fetchReply: async () => ({ edit: async () => {}, delete: async () => {}, createMessageComponentCollector: () => ({ on() {} }) }),
  };
  return { i, log };
}
test.after(() => music.getQueue('ctx-g')?.destroy());

test('command definition: a message context menu command named "Play this", servers only', () => {
  const json = command.data.toJSON();
  assert.equal(json.name, 'Play this');
  assert.equal(json.type, 3);
  assert.deepEqual(json.contexts, [0], 'guild only');
  assert.equal(json.description, undefined);
});

test('right-click on a message with a link plays it (same flow as /play) and shows the live card', async () => {
  music.getQueue('ctx-g')?.destroy();
  let resolved = null;
  music.resolve = async (query) => { resolved = query; return [{ title: 'Found Song', url: 'https://www.youtube.com/watch?v=ctx0000001', duration: 120, source: 'youtube' }]; };
  const c = invoke(message({ content: 'omg listen https://www.youtube.com/watch?v=ctx0000001 !!' }));
  await command.execute(c.i);
  await wait();
  assert.equal(resolved, 'https://www.youtube.com/watch?v=ctx0000001');
  const q = music.getQueue('ctx-g');
  assert.equal(q.current.title, 'Found Song');
  assert.equal(q.current.requestedBy, 'Tester');
  const card = c.log.find((l) => l[0] === 'edit')[1];
  assert.ok(card.components.length >= 2, 'the reply is the interactive Now Playing card');
  q.destroy();
});

test('a second right-click queues behind the playing song', async () => {
  music.getQueue('ctx-g')?.destroy();
  music.resolve = async (query) => [{ title: query, url: `https://www.youtube.com/watch?v=${query.length}ctx000000`.slice(0, 43), duration: 90, source: 'youtube' }];
  await command.execute(invoke(message({ content: 'first song name' })).i);
  await wait();
  const second = invoke(message({ content: 'second song name' }));
  await command.execute(second.i);
  assert.match(second.log.find((l) => l[0] === 'edit')[1].embeds[0].toJSON().author.name, /Added to queue/);
  music.getQueue('ctx-g').destroy();
});

test('nothing playable in the message, or not in a voice channel, is answered privately without searching', async () => {
  let searched = 0;
  music.resolve = async () => { searched++; return []; };
  const empty = invoke(message({ content: '🙂' }));
  await command.execute(empty.i);
  assert.equal(empty.log[0][1].ephemeral, true);
  assert.match(text(empty.log[0][1]), /couldn’t find a link, audio file or song name/);
  const lonely = invoke(message({ content: 'some song' }), { inVoice: false });
  await command.execute(lonely.i);
  assert.match(text(lonely.log[0][1]), /Join a voice channel first/);
  assert.equal(searched, 0);
});

test('a playlist link opens the playlist prompt instead of queueing blindly', async () => {
  music.getQueue('ctx-g')?.destroy();
  music.resolve = async () => Array.from({ length: 12 }, (_, k) => ({ title: `T${k}`, url: `https://www.youtube.com/watch?v=pl${String(k).padStart(8, '0')}`, duration: 100, source: 'youtube', playlistTitle: 'My list' }));
  const c = invoke(message({ content: 'https://www.youtube.com/playlist?list=PL123' }));
  await command.execute(c.i);
  const prompt = c.log.find((l) => l[0] === 'edit')[1];
  assert.equal(prompt.embeds[0].toJSON().title, 'My list');
  assert.equal(music.getQueue('ctx-g'), undefined, 'nothing is queued until the user chooses');
});

test('/help lists right-click commands separately and never prints "undefined"', async () => {
  const help = require('../src/commands/help');
  const log = [];
  await help.execute({ reply: async (o) => log.push(o) });
  const description = text(log[0]);
  assert.doesNotMatch(description, /undefined/);
  assert.match(description, /Right-click a message → Apps:\*\* \*\*Play this\*\*/);
  assert.match(description, /\*\*\/play\*\* — /);
  assert.equal(description.includes('**/Play this**'), false);
});

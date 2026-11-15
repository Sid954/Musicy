const test = require('node:test');
const assert = require('node:assert/strict');
const { fmt, formatClock } = require('../src/music/format');
const { blockBar } = require('../src/music/progress');
const { displayTitle } = require('../src/music/title');
const { buildNowPlayingEmbed, buildNowPlayingRows, buildNowPlayingCard, buildFinishedEmbed, cardState } = require('../src/music/nowplaying-view');

const track = { title: 'Sami Yusuf - Make Me Strong #worldmusic', url: 'https://youtu.be/abc', duration: 237, author: 'Sami Yusuf', requestedBy: 'Sid', thumbnail: 'https://i.ytimg.com/x.jpg' };
const comps = (rows) => rows.flatMap((row) => row.toJSON().components);

test('REGRESSION: elapsed 0 renders 0:00, never "Live"', () => {
  assert.equal(formatClock(0), '0:00');
  assert.equal(formatClock(NaN), '0:00');
  assert.equal(formatClock(-5), '0:00');
  assert.equal(formatClock(75), '1:15');
  assert.equal(formatClock(3725), '1:02:05');
  assert.equal(fmt(0), 'Live'); // a duration of 0 still means live
  const embed = buildNowPlayingEmbed({ track, elapsed: 0 }).toJSON();
  assert.match(embed.description, / 0:00 \/ 3:57$/);
  assert.doesNotMatch(embed.description, /Live/i);
  assert.equal(embed.fields.find((f) => f.name === 'Duration').value, '3:57');
});

test('block bar fills proportionally and clamps', () => {
  assert.equal(blockBar(0, 100, 10), '▱▱▱▱▱▱▱▱▱▱');
  assert.equal(blockBar(50, 100, 10), '▰▰▰▰▰▱▱▱▱▱');
  assert.equal(blockBar(500, 100, 10), '▰▰▰▰▰▰▰▰▰▰');
  assert.equal(blockBar(5, 0, 10), '');
});

test('displayTitle strips noise for display only and falls back to the original', () => {
  assert.equal(displayTitle('Sami Yusuf - Make Me Strong #worldmusic'), 'Sami Yusuf - Make Me Strong');
  assert.equal(displayTitle('Adele - Hello (Official Music Video)'), 'Adele - Hello');
  assert.equal(displayTitle('Song [Lyrics] [HD] #fyp #viral'), 'Song');
  assert.equal(displayTitle('Artist - Topic'), 'Artist');
  assert.equal(displayTitle('Song (Live at Wembley)'), 'Song (Live at Wembley)');
  assert.equal(displayTitle('#onlyhashtag'), '#onlyhashtag');
  assert.equal(displayTitle(''), 'Unknown');
});

test('card states: playing, paused, live and autoplay change header and colour', () => {
  const header = (extra) => buildNowPlayingEmbed({ track, ...extra }).toJSON();
  assert.equal(cardState({ track }), 'playing');
  assert.equal(header({}).author.name, '▶ Now playing');
  assert.equal(header({ paused: true }).author.name, '⏸ Paused');
  assert.equal(header({ paused: true }).color, 0xfee75c);
  const live = buildNowPlayingEmbed({ track: { ...track, duration: 0, isLive: true } }).toJSON();
  assert.equal(live.author.name, '🔴 Live');
  assert.match(live.description, /🔴 \*\*LIVE\*\*/);
  assert.doesNotMatch(live.description, /▰|▱/);
  assert.equal(header({ track: { ...track, autoplay: true } }).author.name, '📻 Autoplay');
});

test('card keeps the original look: slider bar + Duration/Channel/Requested by, plus Up next, queue totals and settings', () => {
  const e = buildNowPlayingEmbed({
    track, elapsed: 60, badges: ['🔁 Loop: queue', '🔊 80%'], next: { title: 'Next Song (Official Video)', duration: 200 }, queuedCount: 13, remainingSeconds: 3000,
  }).toJSON();
  assert.equal(e.title, 'Sami Yusuf - Make Me Strong');
  assert.equal(e.url, 'https://youtu.be/abc');
  assert.match(e.description, /^▬+🔘▬+ 1:00 \/ 3:57$/, 'the original slider bar with plain elapsed / total');
  const fields = Object.fromEntries(e.fields.map((f) => [f.name, f]));
  assert.deepEqual(e.fields.map((f) => f.name), ['Duration', 'Channel', 'Requested by', 'Up next', 'Settings']);
  assert.equal(fields.Duration.value, '3:57');
  assert.equal(fields.Channel.value, 'Sami Yusuf');
  assert.equal(fields['Requested by'].value, 'Sid');
  assert.deepEqual([fields.Duration.inline, fields.Channel.inline, fields['Requested by'].inline], [true, true, true]);
  assert.equal(fields['Up next'].value, 'Next Song · 3:20\n12 more · 50m left');
  assert.equal(fields['Up next'].inline, false);
  assert.equal(fields.Settings.value, '🔁 Loop: queue  ·  🔊 80%');
  assert.equal(e.thumbnail.url, 'https://i.ytimg.com/x.jpg');
  const none = buildNowPlayingEmbed({ track: { title: 'x', duration: 10 } }).toJSON();
  assert.deepEqual(none.fields.map((f) => f.name), ['Duration', 'Channel'], 'no Up next / Settings / Requested by when empty');
  assert.equal(none.fields[1].value, 'Unknown');
  assert.equal(none.thumbnail, undefined);
});

test('Up next shows only what exists: last track queued, nothing queued, live streams', () => {
  const upNext = (extra) => buildNowPlayingEmbed({ track, ...extra }).toJSON().fields.find((f) => f.name === 'Up next')?.value;
  assert.equal(upNext({ next: { title: 'Only One', duration: 90 }, queuedCount: 1, remainingSeconds: 90 }), 'Only One · 1:30\n1m left');
  assert.equal(upNext({}), undefined);
  const live = buildNowPlayingEmbed({ track: { title: 'Radio', isLive: true, duration: 0, author: 'SomaFM' }, next: { title: 'Next', duration: 60 }, queuedCount: 2, remainingSeconds: 120 }).toJSON();
  assert.equal(live.fields.find((f) => f.name === 'Duration').value, 'Live');
  assert.equal(live.description, '🔴 **LIVE**');
});

test('card respects Discord limits for huge titles and fields', () => {
  const big = 'é'.repeat(500);
  const e = buildNowPlayingEmbed({ track: { title: big, author: big, requestedBy: big, duration: 100, url: 'https://x.test/' }, badges: Array(30).fill('🔊 100%'), next: { title: big, duration: 5 }, queuedCount: 500 }).toJSON();
  assert.ok(e.title.length <= 256);
  assert.ok(e.description.length <= 4096);
  for (const field of e.fields) assert.ok(field.name.length <= 256 && field.value.length <= 1024, field.name);
  const total = e.title.length + e.description.length + e.fields.reduce((n, f) => n + f.name.length + f.value.length, 0);
  assert.ok(total <= 6000, `embed total ${total}`);
});

test('controls: <=3 rows of <=5 buttons, correct ids, state-dependent look', () => {
  const rows = buildNowPlayingRows({ paused: false, loop: 'off', canPrevious: true });
  assert.ok(rows.length <= 3 && rows.every((r) => r.toJSON().components.length <= 5));
  assert.deepEqual(comps(rows).map((b) => b.custom_id), ['np:prev', 'np:pause', 'np:skip', 'np:stop', 'np:loop', 'np:shuffle', 'np:queue', 'np:favorite', 'np:lyrics']);
  const [prev, pause, , stop, loop] = comps(rows);
  assert.equal(prev.disabled, false);
  assert.equal(pause.emoji.name, '⏸️');
  assert.equal(pause.style, 1); // primary
  assert.equal(stop.style, 4); // danger
  assert.equal(loop.style, 2); // secondary when off
  const paused = comps(buildNowPlayingRows({ paused: true, loop: 'track', canPrevious: false }));
  assert.equal(paused[0].disabled, true); // no previous track
  assert.equal(paused[1].emoji.name, '▶️');
  assert.equal(paused[1].style, 3); // success
  assert.equal(paused[4].style, 3);
  assert.equal(paused[4].emoji.name, '🔂');
  assert.ok(comps(buildNowPlayingRows({ disabled: true, canPrevious: true })).every((b) => b.disabled));
});

test('buildNowPlayingCard can omit controls and the finished embed is compact', () => {
  assert.deepEqual(buildNowPlayingCard({ track }, { withControls: false }).rows, []);
  assert.equal(buildNowPlayingCard({ track }).rows.length, 2);
  const done = buildFinishedEmbed(track).toJSON();
  assert.match(done.description, /Finished: \*\*Sami Yusuf - Make Me Strong\*\*/);
  assert.equal(done.thumbnail, undefined);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLrc, currentLineIndex, buildLiveLyricsEmbed } = require('../src/music/lrc');
const { startLiveLyrics, stopLiveLyrics, activeCount } = require('../src/music/live-lyrics');
const { formatVoiceStatus, createVoiceStatusUpdater, MAX_STATUS } = require('../src/music/voice-status');

const LRC = `[ar:Someone]
[ti:Song]
[offset:+500]
[00:10.00]First line
[00:20.50]Second line
[00:30.5][01:05.25]Chorus
[00:40]
[bad]ignored`;

test('parseLrc reads timestamps, repeats, empty lines, offsets and ignores metadata', () => {
  const lines = parseLrc(LRC);
  assert.deepEqual(lines.map((l) => [l.time, l.text]), [
    [9.5, 'First line'], [20, 'Second line'], [30, 'Chorus'], [39.5, ''], [64.75, 'Chorus'],
  ]);
  assert.deepEqual(parseLrc(''), []);
  assert.deepEqual(parseLrc(null), []);
  assert.equal(parseLrc('[01:02.345]ms precision')[0].time, 62.345);
  assert.equal(parseLrc('[00:05]x\n[00:01]y').map((l) => l.text).join(), 'y,x', 'sorted by time');
});

test('currentLineIndex finds the active line, -1 before the first and the last one at the end', () => {
  const lines = parseLrc(LRC);
  assert.equal(currentLineIndex(lines, 0), -1);
  assert.equal(currentLineIndex(lines, 9.5), 0);
  assert.equal(currentLineIndex(lines, 25), 1);
  assert.equal(currentLineIndex(lines, 1000), lines.length - 1);
  assert.equal(currentLineIndex([], 5), -1);
});

test('live lyrics embed shows previous, current and next lines within limits', () => {
  const lines = parseLrc(LRC);
  const text = buildLiveLyricsEmbed({ title: 'Song', lines, index: 1 }).toJSON().description;
  assert.match(text, /-# First line/);
  assert.match(text, /\*\*Second line\*\*/);
  assert.match(text, /-# Chorus/);
  assert.match(buildLiveLyricsEmbed({ title: 'S', lines, index: 3 }).toJSON().description, /\*\*♪\*\*/);
  assert.match(buildLiveLyricsEmbed({ title: 'S', lines, index: -1 }).toJSON().description, /♪ …/);
  assert.match(buildLiveLyricsEmbed({ title: 'S', lines, index: 0, ended: true }).toJSON().description, /Lyrics ended/);
  const huge = buildLiveLyricsEmbed({ title: 'x'.repeat(500), lines: [{ time: 0, text: 'é'.repeat(500) }], index: 0 }).toJSON();
  assert.ok(huge.title.length <= 256 && huge.description.length <= 4096);
});

// A manual scheduler so the lyrics loop can be driven without waiting.
function harness({ elapsed = 0, status = 'playing' } = {}) {
  const track = { title: 'Song' };
  const queue = { current: track, elapsed, player: { state: { status } }, getElapsedSeconds() { return this.elapsed; } };
  const edits = [];
  const message = { edit: async (payload) => { edits.push(payload.embeds[0].toJSON().description); } };
  const timers = [];
  const options = {
    guildId: 'g', getQueue: () => queue, track, lines: parseLrc(LRC), message, title: 'Song',
    schedule: (fn) => { timers.push(fn); return { unref() {} }; }, cancel() {},
  };
  const advance = async () => { const fn = timers.shift(); if (fn) await fn(); };
  return { queue, track, edits, options, advance, timers };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('live lyrics edits only when the line changes, skips while paused, and stops when the track changes', async () => {
  const h = harness({ elapsed: 0 });
  const live = startLiveLyrics(h.options);
  await settle();
  assert.equal(h.edits.length, 1, 'first render');
  h.queue.elapsed = 1;
  await h.advance();
  assert.equal(h.edits.length, 1, 'same line: no edit');
  h.queue.elapsed = 25;
  await h.advance();
  assert.equal(h.edits.length, 2);
  assert.match(h.edits[1], /\*\*Second line\*\*/);
  h.queue.player.state.status = 'paused';
  h.queue.elapsed = 70;
  await h.advance();
  assert.equal(h.edits.length, 2, 'paused: no edit');
  h.queue.player.state.status = 'playing';
  await h.advance();
  assert.equal(h.edits.length, 3);
  h.queue.current = { title: 'Another song' };
  await h.advance();
  await settle();
  assert.equal(live.stopped, true);
  assert.match(h.edits.at(-1), /Lyrics ended/);
  assert.equal(activeCount(), 0);
});

test('live lyrics: one per guild (a new one replaces the old) and stops on edit failure or when the queue is gone', async () => {
  const a = harness();
  const first = startLiveLyrics(a.options);
  await settle();
  const b = harness();
  const second = startLiveLyrics(b.options);
  await settle();
  assert.equal(first.stopped, true);
  assert.equal(second.stopped, false);
  assert.equal(activeCount(), 1);
  stopLiveLyrics('g');
  await settle();
  assert.equal(activeCount(), 0);

  const failing = harness();
  failing.options.message = { edit: async () => { throw new Error('Unknown Message'); } };
  const live = startLiveLyrics(failing.options);
  await settle();
  assert.equal(live.stopped, true);
  assert.equal(activeCount(), 0);

  const gone = harness();
  gone.options.getQueue = () => undefined;
  const ended = startLiveLyrics(gone.options);
  await settle();
  assert.equal(ended.stopped, true);
});

test('live lyrics never schedules faster than 5 seconds and has a hard time limit', async () => {
  const h = harness();
  let scheduledMs = null;
  h.options.schedule = (fn, ms) => { scheduledMs = ms; return { unref() {} }; };
  h.options.intervalMs = 100;
  startLiveLyrics(h.options);
  await settle();
  assert.equal(scheduledMs, 5000);
  stopLiveLyrics('g');
  let clock = 0;
  const timed = harness();
  timed.options.now = () => clock;
  timed.options.maxMs = 1000;
  const live = startLiveLyrics(timed.options);
  await settle();
  clock = 5000;
  await timed.advance();
  assert.equal(live.stopped, true);
});

test('voice status text is clipped, cleaned and empty without a track', () => {
  assert.equal(formatVoiceStatus(null), '');
  assert.equal(formatVoiceStatus({ title: 'Adele - Hello (Official Video) #fyp' }), '🎵 Adele - Hello');
  assert.ok(formatVoiceStatus({ title: 'é'.repeat(900) }).length <= MAX_STATUS);
});

test('voice status updater sends once per change, clears only what it set, and backs off after a permission error', async () => {
  const calls = [];
  let fail = null;
  const rest = { put: async (route, { body }) => { calls.push([route, body.status]); if (fail) throw fail; } };
  let clock = 0;
  const updater = createVoiceStatusUpdater({ rest, now: () => clock });
  assert.equal(await updater.clear('c1'), false, 'nothing set yet: no API call');
  assert.equal(calls.length, 0);
  await updater.set('c1', { title: 'Song A' });
  await updater.set('c1', { title: 'Song A' });
  assert.deepEqual(calls, [['/channels/c1/voice-status', '🎵 Song A']]);
  await updater.set('c1', { title: 'Song B' });
  await updater.clear('c1');
  assert.deepEqual(calls.at(-1), ['/channels/c1/voice-status', '']);
  fail = Object.assign(new Error('Missing Permissions'), { code: 50013 });
  assert.equal(await updater.set('c2', { title: 'X' }), false);
  assert.equal(updater.blocked, true);
  const before = calls.length;
  assert.equal(await updater.set('c3', { title: 'Y' }), false);
  assert.equal(calls.length, before, 'blocked: no more requests');
  clock += 11 * 60_000;
  fail = null;
  assert.equal(await updater.set('c3', { title: 'Y' }), true);
  assert.equal(await createVoiceStatusUpdater({ rest: null }).set('c', { title: 'x' }), false);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { createUndoStack, DEFAULT_LIMIT } = require('../src/music/undo-stack');

test('stack: LIFO, shallow-copies the list, bounded, expiring', () => {
  let clock = 0;
  const stack = createUndoStack({ limit: 3, maxAgeMs: 1000, now: () => clock });
  const list = ['a', 'b'];
  stack.push('first', list);
  list.push('c'); // later mutation of the live list must not leak into the snapshot
  assert.deepEqual(stack.pop().tracks, ['a', 'b']);
  assert.equal(stack.pop(), null);
  for (const n of [1, 2, 3, 4, 5]) stack.push(`step ${n}`, [n]);
  assert.equal(stack.size, 3, 'only the newest 3 are kept');
  assert.equal(stack.peek(), 'step 5');
  assert.equal(stack.pop().label, 'step 5');
  clock = 5000;
  assert.equal(stack.pop(), null, 'snapshots older than the max age are dropped');
  stack.push('x', []);
  stack.clear();
  assert.equal(stack.size, 0);
  assert.equal(DEFAULT_LIMIT, 10);
});

// ---- real GuildQueue ----
const storePath = require.resolve('../src/store');
require.cache[storePath] = { id: storePath, filename: storePath, loaded: true, exports: { get: () => ({ volume: 100, filterPresets: [], cleanupNowPlaying: 'edit', maxQueueLength: 500, maxTrackDuration: 10800 }), set: () => ({}) } };
require('../src/music/queue-store').createQueueStore = () => ({ delete() {}, set() {}, entries: () => [], flush: async () => {}, load: async () => {} });
require('../src/music/sources/youtube').stream = async () => ({ stream: new PassThrough(), kill() {} });
const music = require('../src/music/player');

const vc = { id: 'v1', members: { filter: () => ({ size: 1 }) }, guild: { voiceAdapterCreator: () => ({ sendPayload: () => true, destroy() {} }) } };
const text = { id: 't', send: async () => ({ edit: async () => {}, delete: async () => {} }) };
const wait = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));
const song = (n) => ({ title: `Song ${n}`, url: `https://www.youtube.com/watch?v=undo${String(n).padStart(7, '0')}`, duration: 180, source: 'youtube' });
const names = (q) => q.tracks.map((t) => t.title.replace('Song ', ''));
async function fresh() {
  music.getQueue('undo-g')?.destroy();
  const q = music.getOrCreate('undo-g', vc, text);
  q.enqueue([1, 2, 3, 4, 5, 6].map(song)); // Song 1 starts playing; 2-6 are queued
  await wait();
  q.undoStack.clear();
  return q;
}
test.after(() => music.getQueue('undo-g')?.destroy());

test('undo restores the queue after remove, move, shuffle, clear, skip-ahead, dedupe and play-next', async () => {
  const q = await fresh();
  assert.deepEqual(names(q), ['2', '3', '4', '5', '6']);

  q.remove(2);
  assert.deepEqual(names(q), ['2', '4', '5', '6']);
  assert.equal(q.undo().label, 'remove a track');
  assert.deepEqual(names(q), ['2', '3', '4', '5', '6']);

  q.move(5, 1);
  assert.deepEqual(names(q), ['6', '2', '3', '4', '5']);
  q.undo();
  assert.deepEqual(names(q), ['2', '3', '4', '5', '6']);

  q.shuffle(() => 0);
  assert.notDeepEqual(names(q), ['2', '3', '4', '5', '6']);
  assert.equal(q.undo().label, 'shuffle');
  assert.deepEqual(names(q), ['2', '3', '4', '5', '6']);

  assert.equal(q.clearQueue(), 5);
  assert.deepEqual(names(q), []);
  assert.deepEqual(q.undo(), { label: 'clear the queue', count: 5 });
  assert.deepEqual(names(q), ['2', '3', '4', '5', '6']);

  q.playNext([song(9), song(8)]);
  assert.deepEqual(names(q), ['9', '8', '2', '3', '4', '5', '6']);
  assert.equal(q.undo().label, 'play 2 tracks next');
  assert.deepEqual(names(q), ['2', '3', '4', '5', '6']);
  q.destroy();
});

test('undo of "add" removes just what was added; several undos walk back in order', async () => {
  const q = await fresh();
  q.enqueue([song(7), song(8)]);
  q.remove(1);
  q.clearQueue();
  assert.deepEqual(names(q), []);
  assert.equal(q.undo().label, 'clear the queue');
  assert.equal(q.undo().label, 'remove a track');
  assert.equal(q.undo().label, 'add 2 tracks');
  assert.deepEqual(names(q), ['2', '3', '4', '5', '6']);
  assert.equal(q.undo(), null, 'nothing left to undo');
  q.destroy();
});

test('failed changes record nothing, and an empty-queue clear/shuffle is not an undo step', async () => {
  const q = await fresh();
  assert.equal(q.remove(99), null);
  assert.equal(q.move(1, 99), false);
  assert.equal(q.skipTo(99), null);
  assert.equal(q.dedupe(), 0);
  assert.equal(q.undoStack.size, 0);
  q.clearQueue();
  q.undoStack.clear();
  q.clearQueue();
  q.shuffle();
  assert.equal(q.undoStack.size, 0, 'clearing/shuffling an already empty queue changes nothing');
  q.destroy();
});

test('undo never queues the currently playing track twice and keeps playback untouched', async () => {
  const q = await fresh();
  const playing = q.current;
  q.skipTo(3); // discards 2, plays 4 next (skipping the current Song 1)
  await wait();
  assert.notEqual(q.current, playing);
  const restored = q.undo();
  assert.equal(restored.label, 'skip ahead');
  assert.equal(q.tracks.includes(q.current), false, 'the new current track is not in the queue twice');
  q.destroy();
});

test('stopping or leaving forgets the undo history', async () => {
  const q = await fresh();
  q.remove(1);
  assert.equal(q.undoStack.size, 1);
  q.stop();
  assert.equal(q.undoStack.size, 0);
  assert.equal(q.undo(), null);
  q.destroy();
});

test('/undo command: DJ-restricted, answers privately when empty, confirms what it restored', async () => {
  const { RESTRICTED_COMMANDS } = require('../src/music/permissions');
  assert.ok(RESTRICTED_COMMANDS.has('undo'));
  const command = require('../src/commands/undo');
  assert.equal(command.data.name, 'undo');
  const q = await fresh();
  const replies = [];
  const interaction = {
    guildId: 'undo-g', commandName: 'undo', channelId: 'c', member: { voice: { channelId: 'v1' }, permissions: { has: () => true } },
    guild: { members: { me: { voice: { channelId: 'v1' } } } },
    reply: async (payload) => replies.push(payload),
  };
  await command.execute(interaction);
  assert.equal(replies[0].ephemeral, true);
  assert.match(replies[0].embeds[0].toJSON().description, /Nothing to undo/);
  q.clearQueue();
  await command.execute(interaction);
  assert.match(replies[1].embeds[0].toJSON().description, /Undid \*\*clear the queue\*\*\. The queue has \*\*5\*\* tracks again/);
  q.destroy();
});

test('undo of "remove duplicates" brings the duplicates back', async () => {
  const q = await fresh();
  q.enqueue([song(2), song(3), song(1)]); // duplicates of queued tracks 2, 3 and of the playing track 1
  q.undoStack.clear();
  assert.deepEqual(names(q), ['2', '3', '4', '5', '6', '2', '3', '1']);
  assert.equal(q.dedupe(), 3);
  assert.deepEqual(names(q), ['2', '3', '4', '5', '6']);
  assert.equal(q.undo().label, 'remove duplicates');
  assert.deepEqual(names(q), ['2', '3', '4', '5', '6', '2', '3', '1']);
  q.destroy();
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { summarize, formatTotal, orderTracks, uniquePlaylistName } = require('../src/music/collection');

const tracks = [
  { title: 'a', duration: 100, playlistTitle: 'My Mix' },
  { title: 'b', duration: 200 },
  { title: 'c', duration: 0, isLive: true },
];

test('summarize counts tracks, total length, live streams and playlist title', () => {
  assert.deepEqual(summarize(tracks), { count: 3, totalSeconds: 300, liveCount: 1, title: 'My Mix' });
  assert.equal(summarize([{ title: 'x' }]).title, null);
});

test('formatTotal renders hours, minutes and seconds compactly', () => {
  assert.equal(formatTotal(0), '0s');
  assert.equal(formatTotal(45), '45s');
  assert.equal(formatTotal(300), '5m');
  assert.equal(formatTotal(3 * 3600 + 20 * 60), '3h 20m');
});

test('orderTracks never mutates the input and supports order/shuffle/first', () => {
  const input = [1, 2, 3, 4, 5].map((n) => ({ title: String(n) }));
  const snapshot = input.map((t) => t.title).join();
  assert.equal(orderTracks(input, 'order').map((t) => t.title).join(), snapshot);
  assert.deepEqual(orderTracks(input, 'first').map((t) => t.title), ['1']);
  const shuffled = orderTracks(input, 'shuffle', () => 0);
  assert.equal(shuffled.length, 5);
  assert.notEqual(shuffled, input);
  assert.equal(input.map((t) => t.title).join(), snapshot);
  assert.deepEqual([...shuffled.map((t) => t.title)].sort(), ['1', '2', '3', '4', '5']);
});

test('uniquePlaylistName avoids collisions and respects the 32 character limit', () => {
  assert.equal(uniquePlaylistName('Chill', []), 'Chill');
  assert.equal(uniquePlaylistName('Chill', ['Chill']), 'Chill 2');
  assert.equal(uniquePlaylistName('Chill', ['Chill', 'Chill 2']), 'Chill 3');
  const long = 'x'.repeat(40);
  const name = uniquePlaylistName(long, ['x'.repeat(32)]);
  assert.ok(name.length <= 32);
  assert.equal(name.endsWith(' 2'), true);
  assert.equal(uniquePlaylistName('', []), 'Saved playlist');
});

const { trackKey, dedupeAgainst, parseCount, prepareSelection } = require('../src/music/collection');

test('trackKey identifies the same video across URL shapes and falls back to spotify query / url', () => {
  const ids = [
    'https://www.youtube.com/watch?v=abc123XYZ_-&list=PL1',
    'https://youtu.be/abc123XYZ_-',
    'https://www.youtube.com/shorts/abc123XYZ_-',
  ].map((url) => trackKey({ url }));
  assert.deepEqual(new Set(ids), new Set(['yt:abc123XYZ_-']));
  assert.equal(trackKey({ spotifyQuery: 'Adele - Hello', url: 'https://open.spotify.com/album/x' }), 'sp:adele - hello');
  assert.equal(trackKey({ url: 'https://soundcloud.com/a/b' }), 'url:https://soundcloud.com/a/b');
});

test('dedupeAgainst removes already-present tracks and ignores empty slots', () => {
  const tracks = [{ url: 'https://youtu.be/aaaaaa1' }, { url: 'https://youtu.be/bbbbbb2' }];
  assert.deepEqual(dedupeAgainst(tracks, [null, { url: 'https://www.youtube.com/watch?v=aaaaaa1' }]), [tracks[1]]);
  assert.deepEqual(dedupeAgainst(tracks, []), tracks);
});

test('parseCount accepts whole numbers only and clamps to the maximum', () => {
  assert.equal(parseCount('10', 50), 10);
  assert.equal(parseCount(' 7 ', 50), 7);
  assert.equal(parseCount('999', 50), 50);
  for (const bad of ['0', '-3', '2.5', 'abc', '', null, undefined, '1e3']) assert.equal(parseCount(bad, 50), null, String(bad));
});

test('prepareSelection applies first-N, ordering and duplicate filtering together', () => {
  const tracks = Array.from({ length: 6 }, (_, k) => ({ title: `T${k}`, url: `https://youtu.be/vid${k}0000` }));
  const first3 = prepareSelection(tracks, { count: 3 });
  assert.deepEqual(first3.chosen.map((t) => t.title), ['T0', 'T1', 'T2']);
  const dup = prepareSelection(tracks, { count: 3, skipDuplicates: true, existing: [tracks[1]] });
  assert.deepEqual(dup.chosen.map((t) => t.title), ['T0', 'T2']);
  assert.equal(dup.skipped, 1);
  const shuffled = prepareSelection(tracks, { mode: 'shuffle', random: () => 0 });
  assert.equal(shuffled.chosen.length, 6);
  assert.equal(prepareSelection(tracks, { mode: 'first' }).chosen.length, 1);
});

test('prepareSelection enforces the queue-room limit and the per-track length limit', () => {
  const mk = (n, duration = 100) => ({ title: `T${n}`, url: `https://youtu.be/lim${String(n).padStart(6, '0')}`, duration });
  const tracks = [mk(1), mk(2), mk(3, 9000), mk(4), mk(5), mk(6)];
  const r = prepareSelection(tracks, { limit: 3, maxDuration: 600 });
  assert.deepEqual(r.chosen.map((t) => t.title), ['T1', 'T2', 'T4']);
  assert.equal(r.tooLong, 1);
  assert.equal(r.trimmed, 2);
  const none = prepareSelection(tracks, { limit: 0 });
  assert.equal(none.chosen.length, 0);
  assert.equal(prepareSelection(tracks, {}).chosen.length, 6, 'no limits by default');
  assert.equal(prepareSelection(tracks, { maxDuration: 0 }).tooLong, 0, 'maxDuration 0 means unlimited');
  const live = prepareSelection([{ title: 'radio', url: 'https://x.test/r', duration: 0, isLive: true }], { maxDuration: 600 });
  assert.equal(live.chosen.length, 1, 'live streams (duration 0) are never "too long"');
});

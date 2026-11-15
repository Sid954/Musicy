const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanTitle, splitLyrics, lookupLyrics } = require('../src/music/lyrics');

test('cleanTitle removes common video labels, features, and YouTube topic suffixes', () => {
  assert.equal(cleanTitle('Artist - Song (Official Video) [Lyrics]'), 'Artist - Song');
  assert.equal(cleanTitle('Song ft. Guest Artist - Topic'), 'Song');
  assert.equal(cleanTitle('Track | Remastered'), 'Track');
});

test('splitLyrics keeps each page within its limit and prefers line boundaries', () => {
  const lyrics = `${'line one\n'.repeat(5)}${'x'.repeat(20)}`;
  const pages = splitLyrics(lyrics, 24);
  assert.ok(pages.length > 1);
  assert.ok(pages.every((page) => page.length <= 24));
  assert.equal(pages.join('').replace(/\n/g, ''), lyrics.trim().replace(/\n/g, ''));
  assert.deepEqual(splitLyrics(''), []);
});

test('lookupLyrics tries exact lookup then search fallback and builds encoded query', async () => {
  const requested = [];
  const fetchFn = async (url) => {
    requested.push(url);
    if (url.includes('/api/get?')) return { ok: true, json: async () => null };
    return { ok: true, json: async () => [{ plainLyrics: 'words', syncedLyrics: '[00:00]words' }] };
  };
  const result = await lookupLyrics({ artist: 'Some Artist', title: 'Song (Official Video)', duration: 182 }, fetchFn);
  assert.equal(result.plainLyrics, 'words');
  assert.match(requested[0], /track_name=Song/);
  assert.match(requested[1], /q=Some\+Artist\+Song/);
});

test('lookupLyrics fails silently when LRCLIB is unavailable', async () => {
  assert.equal(await lookupLyrics({ title: 'Song' }, async () => { throw new Error('offline'); }), null);
});

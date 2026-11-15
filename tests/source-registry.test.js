const test = require('node:test');
const assert = require('node:assert/strict');
const { selectSource, attachSource } = require('../src/music/source-registry');

test('selectSource chooses first matching source and falls back to YouTube', () => {
  const youtube = { name: 'youtube' };
  const other = { name: 'other', canHandle: (query) => query.startsWith('https://other.example/') };
  assert.equal(selectSource('https://other.example/song', [youtube, other], youtube), other);
  assert.equal(selectSource('search terms', [youtube, other], youtube), youtube);
});

test('attachSource annotates every resolved track with its source name', () => {
  const tracks = [{ title: 'one' }, { title: 'two' }];
  const source = { name: 'youtube' };
  assert.equal(attachSource(tracks, source), tracks);
  assert.deepEqual(tracks.map((track) => track.source), ['youtube', 'youtube']);
});

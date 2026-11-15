const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRadioArgs } = require('../src/music/sources/ytdlp-generic');
const { liveSafeFilters, composeFilters } = require('../src/music/effects');

const URL_ = 'https://ice1.somafm.com/lush-128-mp3';
const inputOptions = (args) => args.slice(0, args.indexOf('-i'));

test('radio keeps its old shape without options, but reconnects on network drops (input option before -i)', () => {
  const args = buildRadioArgs(URL_);
  assert.deepEqual(args, [
    '-loglevel', 'error', '-protocol_whitelist', 'http,https,tcp,tls,crypto',
    '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5',
    '-i', URL_, '-vn', '-c:a', 'libopus', '-b:a', '96k', '-ar', '48000', '-ac', '2', '-f', 'ogg', 'pipe:1',
  ]);
  const options = inputOptions(args);
  assert.equal(options[options.indexOf('-reconnect') + 1], '1');
  assert.equal(args.includes('-af'), false);
});

test('radio gets loudness leveling, EQ and volume like songs', () => {
  const filters = composeFilters({ autoNormalize: true, eqPreset: 'bass' });
  const args = buildRadioArgs(URL_, { filters, volume: 0.5 });
  const af = args[args.indexOf('-af') + 1];
  assert.match(af, /equalizer=f=31/);
  assert.match(af, /loudnorm=I=-21:TP=-2:LRA=7/);
  assert.ok(af.endsWith('volume=0.5'));
  assert.ok(args.indexOf('-af') > args.indexOf('-i'), 'filters are output options');
  assert.match(buildRadioArgs(URL_, { volume: 1.5 }).join(' '), /volume=1\.5,alimiter=limit=0\.95/);
});

test('speed, pitch and nightcore-style filters are dropped for live streams (they would starve the player)', () => {
  const filters = composeFilters({ speed: 1.5, pitch: 3, filterPresets: ['nightcore', 'bassboost'], autoNormalize: true });
  assert.ok(filters.some((f) => f.startsWith('atempo=')) && filters.some((f) => f.startsWith('asetrate=')));
  const safe = liveSafeFilters(filters);
  assert.equal(safe.some((f) => /^(atempo|asetrate|aresample)=/.test(f)), false);
  assert.ok(safe.includes('bass=g=10'), 'other filters survive');
  assert.ok(safe.some((f) => f.startsWith('loudnorm=')));
  const af = buildRadioArgs(URL_, { filters })[buildRadioArgs(URL_, { filters }).indexOf('-af') + 1];
  assert.doesNotMatch(af, /atempo|asetrate/);
  assert.deepEqual(liveSafeFilters([]), []);
});

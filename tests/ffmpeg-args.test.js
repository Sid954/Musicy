const test = require('node:test');
const assert = require('node:assert/strict');
const { buildFfmpegArgs } = require('../src/music/sources/youtube');

test('buildFfmpegArgs preserves the default audio pipeline', () => {
  assert.deepEqual(buildFfmpegArgs(), [
    '-loglevel', 'error', '-i', 'pipe:0', '-vn',
    '-c:a', 'libopus', '-b:a', '96k', '-ar', '48000', '-ac', '2',
    '-page_duration', '20000', '-f', 'ogg', 'pipe:1',
  ]);
});

test('buildFfmpegArgs applies seek before input and combines filters with volume', () => {
  const args = buildFfmpegArgs({
    seek: 90,
    filters: ['aecho=0.8:0.9:1000:0.3'],
    volume: 1.5,
    input: 'https://audio.example/stream',
  });
  assert.deepEqual(args.slice(0, 6), ['-loglevel', 'error', '-ss', '90', '-protocol_whitelist', 'http,https,tcp,tls,crypto']);
  const input = args.indexOf('-i');
  assert.equal(args[input + 1], 'https://audio.example/stream');
  assert.equal(args[input + 2], '-vn');
  assert.deepEqual(args.slice(input + 3, input + 5), ['-af', 'aecho=0.8:0.9:1000:0.3,volume=1.5,alimiter=limit=0.95']);
});

test('REGRESSION: direct URL inputs reconnect when YouTube drops the connection (songs were cut off 30-60 s early)', () => {
  const url = 'https://rr1.googlevideo.com/videoplayback?x=1';
  const args = buildFfmpegArgs({ input: url, copyOpus: true });
  const input = args.indexOf('-i');
  const options = args.slice(0, input);
  for (const [flag, value] of [['-reconnect', '1'], ['-reconnect_streamed', '1'], ['-reconnect_at_eof', '1'], ['-reconnect_delay_max', '5']]) {
    const at = options.indexOf(flag);
    assert.ok(at >= 0 && options[at + 1] === value, `${flag} ${value} must be an input option (before -i)`);
  }
  assert.deepEqual(buildFfmpegArgs({ seek: 40, input: url }).slice(0, 4), ['-loglevel', 'error', '-ss', '40'], 'seeking still comes first');
  assert.equal(buildFfmpegArgs({ input: 'pipe:0' }).includes('-reconnect'), false, 'pipes have nothing to reconnect');
  assert.equal(buildFfmpegArgs().includes('-reconnect'), false);
});

test('buildFfmpegArgs does not add a limiter at or below unity volume', () => {
  const args = buildFfmpegArgs({ volume: 1 });
  assert.equal(args.includes('-af'), false);
  const quietArgs = buildFfmpegArgs({ volume: 0.5 });
  assert.deepEqual(quietArgs.slice(5, 7), ['-af', 'volume=0.5']);
});

test('copyOpus remuxes without re-encoding when no filter or volume applies', () => {
  const args = buildFfmpegArgs({ input: 'https://audio.example/a', copyOpus: true });
  assert.deepEqual(args.slice(-7), ['-c:a', 'copy', '-page_duration', '20000', '-f', 'ogg', 'pipe:1']);
  assert.equal(args.includes('libopus'), false);
  assert.equal(args.includes('-b:a'), false);
});

test('copyOpus is ignored (re-encodes) when filters or volume change the audio', () => {
  assert.ok(buildFfmpegArgs({ copyOpus: true, volume: 0.5 }).includes('libopus'));
  assert.ok(buildFfmpegArgs({ copyOpus: true, filters: ['bass=g=5'] }).includes('libopus'));
});

test('fades add afade filters and disable the Opus copy fast path', () => {
  const args = buildFfmpegArgs({ copyOpus: true, fade: { duration: 100 } });
  const af = args[args.indexOf('-af') + 1];
  assert.equal(af, 'afade=t=in:st=0:d=1,afade=t=out:st=98:d=2');
  assert.ok(args.includes('libopus'));
  assert.equal(args.includes('copy'), false);
  const resumed = buildFfmpegArgs({ seek: 30, fade: { duration: 100, seek: 30 } });
  assert.equal(resumed[resumed.indexOf('-af') + 1], 'afade=t=out:st=68:d=2');
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fx = require('../src/music/effects');

test('atempoChain keeps every atempo within 0.5-2 and multiplies back to the target', () => {
  assert.deepEqual(fx.atempoChain(1.25), ['atempo=1.25']);
  assert.deepEqual(fx.atempoChain(2), ['atempo=2']);
  assert.deepEqual(fx.atempoChain(0.5), ['atempo=0.5']);
  for (const target of [0.2, 0.3, 0.49, 0.75, 1.5, 2.5, 4, 5.3, 9]) {
    const chain = fx.atempoChain(target);
    const values = chain.map((f) => Number(f.split('=')[1]));
    assert.ok(values.every((v) => v >= 0.5 - 1e-9 && v <= 2 + 1e-9), `${target}: ${chain}`);
    assert.ok(Math.abs(values.reduce((a, b) => a * b, 1) - target) < 1e-3, `${target}: ${chain}`);
  }
  assert.throws(() => fx.atempoChain(0));
  assert.throws(() => fx.atempoChain(NaN));
});

test('speed alone uses atempo; pitch alone uses asetrate and restores the tempo; both combine', () => {
  assert.deepEqual(fx.buildSpeedPitchFilters({}), []);
  assert.deepEqual(fx.buildSpeedPitchFilters({ speed: 1.5 }), ['atempo=1.5']);
  const up12 = fx.buildSpeedPitchFilters({ pitch: 12 });
  assert.deepEqual(up12, ['asetrate=48000*2', 'aresample=48000', 'atempo=0.5']);
  const down12 = fx.buildSpeedPitchFilters({ pitch: -12 });
  assert.deepEqual(down12, ['asetrate=48000*0.5', 'aresample=48000', 'atempo=2']);
  const both = fx.buildSpeedPitchFilters({ speed: 1.25, pitch: 12 });
  assert.equal(both[0], 'asetrate=48000*2');
  assert.deepEqual(both.slice(2), ['atempo=0.625']);
});

test('speed and pitch are clamped to their ranges and reject non-numbers', () => {
  assert.equal(fx.clampSpeed(5), 2);
  assert.equal(fx.clampSpeed(0.1), 0.5);
  assert.equal(fx.clampPitch(40), 12);
  assert.equal(fx.clampPitch(-40), -12);
  assert.equal(fx.clampPitch(2.6), 3);
  assert.throws(() => fx.clampSpeed(NaN), RangeError);
  assert.throws(() => fx.clampPitch('x'), RangeError);
  assert.deepEqual(fx.buildSpeedPitchFilters({ speed: 99 }), ['atempo=2']);
});

test('tempoFactor accounts for tempo-changing presets and speed (pitch is tempo-compensated)', () => {
  assert.equal(fx.tempoFactor({}), 1);
  assert.equal(fx.tempoFactor({ presets: ['nightcore'] }), 1.25);
  assert.equal(fx.tempoFactor({ presets: ['bassboost'] }), 1);
  assert.ok(Math.abs(fx.tempoFactor({ presets: ['nightcore', 'vaporwave'], speed: 2 }) - 2) < 1e-9);
  assert.equal(fx.tempoFactor({ speed: -3 }), 1);
});

test('equalizer presets map to equalizer filters, skipping flat bands and clamping gains', () => {
  assert.deepEqual(fx.buildEqChain({}), []);
  const bass = fx.buildEqChain({ preset: 'bass' });
  assert.equal(bass[0], 'equalizer=f=31:t=o:w=1:g=8');
  assert.equal(bass.length, 5);
  const custom = fx.buildEqChain({ preset: 'flat', bands: { 1000: 20, 62: -50, 7: 3 } });
  assert.deepEqual(custom, ['equalizer=f=62:t=o:w=1:g=-12', 'equalizer=f=1000:t=o:w=1:g=12']);
  assert.throws(() => fx.eqGains('nope'), /Unknown equalizer preset/);
  for (const preset of Object.keys(fx.EQ_PRESETS)) assert.equal(fx.EQ_PRESETS[preset].length, fx.EQ_BANDS.length);
});

test('composeFilters orders eq -> speed/pitch -> presets -> loudnorm', () => {
  const chain = fx.composeFilters({ eqPreset: 'bass', speed: 1.5, filterPresets: ['bassboost'], autoNormalize: true });
  assert.equal(chain[0].startsWith('equalizer='), true);
  const tempoIndex = chain.indexOf('atempo=1.5');
  const presetIndex = chain.indexOf('bass=g=10');
  assert.ok(tempoIndex > 0 && presetIndex > tempoIndex);
  assert.equal(chain.at(-1), 'loudnorm=I=-21:TP=-2:LRA=7');
  assert.equal(fx.composeFilters({ autoNormalize: true, normalizeLevel: 'normal' }).at(-1), 'loudnorm=I=-18:TP=-2:LRA=7');
  assert.deepEqual(fx.composeFilters({}), []);
});

test('fade filters fade in only at the start and out near the end on the output timeline', () => {
  assert.deepEqual(fx.buildFadeFilters({ duration: 100 }), ['afade=t=in:st=0:d=1', 'afade=t=out:st=98:d=2']);
  assert.deepEqual(fx.buildFadeFilters({ duration: 100, seek: 40 }), ['afade=t=out:st=58:d=2']);
  assert.deepEqual(fx.buildFadeFilters({ duration: 100, tempo: 2 }), ['afade=t=in:st=0:d=1', 'afade=t=out:st=49:d=2']);
  assert.deepEqual(fx.buildFadeFilters({ duration: 0 }), ['afade=t=in:st=0:d=1']);
  assert.deepEqual(fx.buildFadeFilters({ duration: 2 }), ['afade=t=in:st=0:d=1']);
});

test('describeEffects lists only active effects for the card', () => {
  assert.deepEqual(fx.describeEffects({}), []);
  assert.deepEqual(fx.describeEffects({ speed: 1.25, pitch: -2, eqPreset: 'rock', fade: true }), ['⏩ 1.25×', '🎵 -2', '🎛 EQ: Rock', '🌅 Fades']);
  assert.deepEqual(fx.describeEffects({ pitch: 3, eqBands: { 1000: 2 } }), ['🎵 +3', '🎛 EQ: custom']);
  assert.deepEqual(fx.describeEffects({ eqPreset: 'bass', eqBands: { 1000: 2 } }), ['🎛 EQ: Bass+']);
});

// Pure ffmpeg audio-effect builders: speed, pitch, equalizer and the final filter-chain composition.
// Everything here returns plain filter strings; nothing touches Discord or the player.
const { buildFilterChain } = require('./filters');

const SPEED_MIN = 0.5;
const SPEED_MAX = 2;
const PITCH_MIN = -12;
const PITCH_MAX = 12;
const EQ_GAIN_LIMIT = 12;
const SAMPLE_RATE = 48000;

// ffmpeg's atempo accepts 0.5-2.0 per instance; chain instances for anything outside that range.
const num = (value) => String(Number(value.toFixed(5)));

function atempoChain(tempo) {
  if (!Number.isFinite(tempo) || tempo <= 0) throw new RangeError('Tempo must be a positive number.');
  const chain = [];
  let rest = tempo;
  while (rest > 2) { chain.push('atempo=2'); rest /= 2; }
  while (rest < 0.5) { chain.push('atempo=0.5'); rest /= 0.5; }
  if (Math.abs(rest - 1) > 1e-9 || chain.length === 0) chain.push(`atempo=${num(rest)}`);
  return chain;
}

function clampSpeed(speed) {
  if (!Number.isFinite(speed)) throw new RangeError('Speed must be a number.');
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, speed));
}

function clampPitch(pitch) {
  if (!Number.isFinite(pitch)) throw new RangeError('Pitch must be a number.');
  return Math.min(PITCH_MAX, Math.max(PITCH_MIN, Math.round(pitch)));
}

// Pitch shifts by resampling (changes pitch AND tempo), then atempo restores the tempo to `speed`.
function buildSpeedPitchFilters({ speed = 1, pitch = 0 } = {}) {
  const s = clampSpeed(speed);
  const p = clampPitch(pitch);
  if (s === 1 && p === 0) return [];
  const filters = [];
  const rate = 2 ** (p / 12);
  if (p !== 0) filters.push(`asetrate=${SAMPLE_RATE}*${num(rate)}`, `aresample=${SAMPLE_RATE}`);
  const tempo = s / rate;
  if (Math.abs(tempo - 1) > 1e-9) filters.push(...atempoChain(tempo));
  return filters;
}

// Net playback-speed factor of a filter setup (source seconds consumed per real second).
// Used to keep the elapsed time / progress bar correct while tempo-changing filters are active.
const PRESET_TEMPO = Object.freeze({ nightcore: 1.25, vaporwave: 0.8 });
function tempoFactor({ presets = [], speed = 1 } = {}) {
  const preset = (Array.isArray(presets) ? presets : []).reduce((factor, name) => factor * (PRESET_TEMPO[name] || 1), 1);
  const s = Number.isFinite(speed) && speed > 0 ? speed : 1;
  return preset * s;
}

// 10-band equalizer (octave bands). Gains in dB.
const EQ_BANDS = Object.freeze([31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]);
const EQ_PRESETS = Object.freeze({
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  rock: [5, 4, 3, 1, -1, -1, 1, 3, 4, 5],
  pop: [-1, 1, 3, 4, 3, 0, -1, -1, 1, 2],
  bass: [8, 7, 5, 3, 1, 0, 0, 0, 0, 0],
  vocal: [-3, -3, -2, 0, 3, 4, 4, 2, 0, -1],
  classical: [0, 0, 0, 0, 0, 0, -2, -3, -3, -4],
});

const clampGain = (gain) => Math.min(EQ_GAIN_LIMIT, Math.max(-EQ_GAIN_LIMIT, Number(gain) || 0));

// bands: { "1000": 4, ... } custom overrides on top of the preset.
function eqGains(preset = 'flat', bands = {}) {
  if (!Object.hasOwn(EQ_PRESETS, preset)) throw new Error(`Unknown equalizer preset: ${preset}`);
  const gains = [...EQ_PRESETS[preset]];
  for (const [hz, gain] of Object.entries(bands || {})) {
    const index = EQ_BANDS.indexOf(Number(hz));
    if (index >= 0) gains[index] = clampGain(gain);
  }
  return gains;
}

function buildEqChain({ preset = 'flat', bands = {} } = {}) {
  return eqGains(preset, bands)
    .map((gain, index) => ({ gain, hz: EQ_BANDS[index] }))
    .filter(({ gain }) => gain !== 0)
    .map(({ hz, gain }) => `equalizer=f=${hz}:t=o:w=1:g=${num(gain)}`);
}

// Order: EQ -> speed/pitch -> presets -> loudness normalisation (last, so it sees the final signal).
function composeFilters({ eqPreset = 'flat', eqBands = {}, speed = 1, pitch = 0, filterPresets = [], autoNormalize = false, normalizeLevel } = {}) {
  return [
    ...buildEqChain({ preset: eqPreset, bands: eqBands }),
    ...buildSpeedPitchFilters({ speed, pitch }),
    ...buildFilterChain(filterPresets, autoNormalize, normalizeLevel),
  ];
}

// Live streams cannot be sped up (the player would starve) or re-pitched, so tempo-changing filters are dropped.
const TEMPO_FILTER = /^(atempo|asetrate|aresample)=/;
function liveSafeFilters(filters = []) {
  return filters.filter((filter) => !TEMPO_FILTER.test(filter));
}

// Fade in at the start of a track and out at the end (re-encode path only).
// `tempo` converts source time to the filter's output timeline.
function buildFadeFilters({ duration = 0, seek = 0, tempo = 1, inSeconds = 1, outSeconds = 2 } = {}) {
  const filters = [];
  if (seek <= 0 && inSeconds > 0) filters.push(`afade=t=in:st=0:d=${num(inSeconds)}`);
  if (duration > outSeconds + 1) {
    const start = Math.max(0, (duration - outSeconds - Math.max(0, seek)) / (tempo > 0 ? tempo : 1));
    filters.push(`afade=t=out:st=${num(start)}:d=${num(outSeconds)}`);
  }
  return filters;
}

const titleCase = (value) => value.charAt(0).toUpperCase() + value.slice(1);

function describeEffects({ speed = 1, pitch = 0, eqPreset = 'flat', eqBands = {}, fade = false } = {}) {
  const badges = [];
  if (speed !== 1) badges.push(`⏩ ${num(speed)}×`);
  if (pitch !== 0) badges.push(`🎵 ${pitch > 0 ? '+' : ''}${pitch}`);
  const custom = Object.keys(eqBands || {}).length > 0;
  if (eqPreset !== 'flat' || custom) badges.push(`🎛 EQ: ${eqPreset === 'flat' ? 'custom' : titleCase(eqPreset)}${eqPreset !== 'flat' && custom ? '+' : ''}`);
  if (fade) badges.push('🌅 Fades');
  return badges;
}

module.exports = {
  SPEED_MIN, SPEED_MAX, PITCH_MIN, PITCH_MAX, EQ_BANDS, EQ_PRESETS, EQ_GAIN_LIMIT,
  liveSafeFilters, atempoChain, clampSpeed, clampPitch, buildSpeedPitchFilters, tempoFactor,
  eqGains, buildEqChain, composeFilters, buildFadeFilters, describeEffects,
};

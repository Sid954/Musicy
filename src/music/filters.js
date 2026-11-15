const PRESETS = Object.freeze({
  off: '',
  bassboost: 'bass=g=10',
  nightcore: 'asetrate=48000*1.25,aresample=48000',
  vaporwave: 'asetrate=48000*0.8,aresample=48000',
  '8d': 'apulsator=hz=0.08',
  treble: 'treble=g=5',
  karaoke: 'pan=stereo|c0=c0-c1|c1=c1-c0',
  loudnorm: 'loudnorm',
});

// Target loudness (LUFS) for the automatic leveller. Raw YouTube songs differ by up to ~17 LU, so every
// song is brought to the same level. The default "soft" (-21) sits ~7 dB under typical loud masters;
// "normal" (-18) and "loud" (-15) are there if that is too quiet.
const LOUDNESS_LEVELS = Object.freeze({ soft: -21, normal: -18, loud: -15 });
const DEFAULT_LOUDNESS_LEVEL = 'soft';

function loudnormFilter(level = DEFAULT_LOUDNESS_LEVEL) {
  const target = Object.hasOwn(LOUDNESS_LEVELS, level) ? LOUDNESS_LEVELS[level] : LOUDNESS_LEVELS[DEFAULT_LOUDNESS_LEVEL];
  return `loudnorm=I=${target}:TP=-2:LRA=7`;
}

function buildFilterChain(names = [], autoNormalize = false, level = DEFAULT_LOUDNESS_LEVEL) {
  if (!Array.isArray(names)) throw new TypeError('Filter names must be an array.');
  const normalized = [...new Set(names.map((name) => String(name).toLowerCase()))];
  if (normalized.includes('off')) return [];
  const chain = normalized.map((name) => {
    if (!Object.hasOwn(PRESETS, name)) throw new Error(`Unknown filter preset: ${name}`);
    return PRESETS[name];
  });
  if (autoNormalize && !normalized.includes('loudnorm')) chain.push(loudnormFilter(level));
  return chain;
}

function updateFilters(current, action, preset) {
  const names = [...new Set((Array.isArray(current) ? current : []).filter((name) => Object.hasOwn(PRESETS, name)))];
  if (action === 'clear') return [];
  if (!Object.hasOwn(PRESETS, preset)) throw new Error('Choose a valid filter preset.');
  if (action === 'add' && preset === 'off') return [];
  if (preset === 'off') throw new Error('The off preset can only be used with add.');
  if (action === 'add') return names.includes(preset) ? names : [...names, preset];
  if (action === 'remove') return names.filter((name) => name !== preset);
  throw new Error('Unknown filter action.');
}

module.exports = { PRESETS, LOUDNESS_LEVELS, DEFAULT_LOUDNESS_LEVEL, loudnormFilter, buildFilterChain, updateFilters };

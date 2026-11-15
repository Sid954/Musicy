const test = require('node:test');
const assert = require('node:assert/strict');
const { progressBar } = require('../src/music/progress');

test('progressBar positions its marker proportionally and clamps elapsed time', () => {
  assert.equal(progressBar(0, 100, 5), '🔘▬▬▬▬');
  assert.equal(progressBar(50, 100, 5), '▬▬🔘▬▬');
  assert.equal(progressBar(100, 100, 5), '▬▬▬▬🔘');
  assert.equal(progressBar(150, 100, 5), '▬▬▬▬🔘');
  assert.equal(progressBar(-10, 100, 5), '🔘▬▬▬▬');
});

test('progressBar handles live or invalid durations and bounds width', () => {
  assert.equal(progressBar(10, 0), 'LIVE');
  assert.equal(progressBar(10, NaN), 'LIVE');
  assert.equal(progressBar(10, 100, 0), '🔘');
  assert.equal([...progressBar(10, 100, 100)].length, 60);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const read = (value) => {
  const env = { ...process.env };
  delete env.LEVELING_DEFAULT;
  if (value !== undefined) env.LEVELING_DEFAULT = value;
  const out = spawnSync(process.execPath, ['-e', "console.log(require('./src/store').DEFAULTS.levelingEnabled)"], { cwd: path.join(__dirname, '..'), env, encoding: 'utf8' });
  return out.stdout.trim();
};

test('leveling is on by default and LEVELING_DEFAULT=off turns it off for new servers', () => {
  assert.equal(read(undefined), 'true');
  assert.equal(read('on'), 'true');
  assert.equal(read('off'), 'false');
  assert.equal(read('OFF'), 'false');
});

const test = require('node:test');
const assert = require('node:assert/strict');

test('logger filters below LOG_LEVEL and timestamps emitted output', () => {
  const { spawnSync } = require('node:child_process');
  const script = "const log=require('./src/log');log.debug('hidden');log.info('visible');log.error(new Error('failure'))";
  const result = spawnSync(process.execPath, ['-e', script], { cwd: process.cwd(), env: { ...process.env, LOG_LEVEL: 'info' }, encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.doesNotMatch(result.stdout, /hidden/);
  assert.match(result.stdout, /\d{4}-\d\d-\d\dT.* INFO visible/);
  assert.match(result.stderr, / ERROR Error: failure/);
});

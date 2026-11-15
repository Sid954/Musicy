// Runs every tests/*.test.js with Node's built-in test runner.
// `node --test tests/` works on some Node versions and fails on others (22+ reads "tests/" as a file name),
// so the files are listed explicitly: this behaves the same on Node 18, 20, 22 and newer.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const dir = path.join(__dirname, '..', 'tests');
const files = fs.readdirSync(dir).filter((name) => name.endsWith('.test.js')).sort().map((name) => path.join(dir, name));
if (!files.length) {
  console.error('No test files found in tests/');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);

// Syntax-checks every JS file under src/ and scripts/ (no linter in this project).
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : [];
  });
}

const root = path.join(__dirname, '..');
let failed = 0;
for (const f of [...walk(path.join(root, 'src')), ...walk(path.join(root, 'scripts'))]) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (e) {
    failed++;
    console.error(`FAIL ${path.relative(root, f)}\n${e.stderr}`);
  }
}
if (failed) process.exit(1);
console.log('syntax ok');

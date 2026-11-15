// `npm run selftest` - checks configuration, helper programs and network WITHOUT connecting to Discord.
// Handy on a new host (Wispbyte console) before the first start. Exit code 1 if anything is broken.
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });
const { runSelfTest, summarize } = require('../src/selftest');
const { formatResult } = require('../src/startup-check');

(async () => {
  console.log('Running self-test (takes about 10 seconds)...\n');
  const results = await runSelfTest({ describeError: (error) => String(error.stderr || error.message).trim().split('\n').pop().slice(0, 200) });
  for (const result of results) console.log(formatResult(result));
  const { errors, warnings } = summarize(results);
  console.log(`\n${errors ? '❌' : warnings ? '⚠️' : '✅'} ${errors} error(s), ${warnings} warning(s).`);
  process.exit(errors ? 1 : 0);
})().catch((error) => { console.error('Self-test crashed:', error); process.exit(1); });

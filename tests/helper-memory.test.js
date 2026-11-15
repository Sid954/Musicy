const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseTasklistCsv, parseProcStatus, parsePsOutput, groupHelpers, readHelperProcesses, formatHelpers, describeTotal,
} = require('../src/music/helper-memory');
const { buildStats } = require('../src/music/stats');

const TASKLIST = [
  '"System Idle Process","0","Services","0","8 K"',
  '"node.exe","4242","Console","1","104,200 K"',
  '"yt-dlp.exe","100","Console","1","9,100 K"',
  '"yt-dlp.exe","101","Console","1","78,000 K"',
  '"ffmpeg.exe","200","Console","1","20,480 K"',
  '"ffmpeg.exe","201","Console","1","22 528 K"',
  'garbage line',
].join('\r\n');

test('tasklist output is parsed, including thousands separators in any locale', () => {
  const entries = parseTasklistCsv(TASKLIST);
  assert.equal(entries.length, 6);
  assert.deepEqual(entries[1], { name: 'node', pid: 4242, kb: 104200 });
  assert.equal(entries.at(-1).kb, 22528);
});

test('Linux /proc status and ps output are parsed', () => {
  assert.deepEqual(parseProcStatus('Name:\tffmpeg\nVmPeak: 1 kB\nVmRSS:\t  20480 kB\n', 77), { name: 'ffmpeg', pid: 77, kb: 20480 });
  assert.equal(parseProcStatus('Name:\tkthreadd\n', 2), null, 'kernel threads have no VmRSS');
  assert.deepEqual(parsePsOutput('  20480 /usr/bin/ffmpeg\n 90000 /app/bin/yt-dlp_linux\n'), [
    { name: 'ffmpeg', pid: 0, kb: 20480 }, { name: 'yt-dlp_linux', pid: 0, kb: 90000 },
  ]);
});

test('groupHelpers sums yt-dlp and ffmpeg separately and ignores everything else', () => {
  const { groups, totalMb } = groupHelpers([...parseTasklistCsv(TASKLIST), { name: 'yt-dlp_linux', pid: 1, kb: 10240 }]);
  assert.deepEqual(groups, { 'yt-dlp': { count: 3, mb: 95 }, ffmpeg: { count: 2, mb: 42 } });
  assert.equal(totalMb, 137);
  assert.deepEqual(groupHelpers([{ name: 'node', pid: 1, kb: 999999 }]), { groups: {}, totalMb: 0 });
});

test('readHelperProcesses works on each platform with injected system access', async () => {
  const win = await readHelperProcesses({ platform: 'win32', exec: async (file) => { assert.equal(file, 'tasklist'); return TASKLIST; } });
  assert.deepEqual(win.map((e) => e.name).sort(), ['ffmpeg', 'ffmpeg', 'yt-dlp', 'yt-dlp']);

  const files = {
    '/proc/10/status': 'Name:\tnode\nVmRSS:\t100000 kB\n',
    '/proc/11/status': 'Name:\tffmpeg\nVmRSS:\t20000 kB\n',
    '/proc/12/status': 'Name:\tyt-dlp_linux\nVmRSS:\t80000 kB\n',
  };
  const linux = await readHelperProcesses({
    platform: 'linux',
    readdir: async () => ['10', '11', '12', '13', 'self', 'cpuinfo'],
    readFile: async (file) => { if (!files[file]) throw new Error('ENOENT'); return files[file]; },
  });
  assert.deepEqual(linux.map((e) => [e.name, e.kb]), [['ffmpeg', 20000], ['yt-dlp_linux', 80000]]);

  const mac = await readHelperProcesses({ platform: 'darwin', exec: async () => '  5000 /bin/sh\n  20480 /opt/ffmpeg\n' });
  assert.deepEqual(mac.map((e) => e.name), ['ffmpeg']);
});

test('formatting and the verdict against the host limit', () => {
  assert.equal(formatHelpers({}), 'none running');
  assert.equal(formatHelpers({ 'yt-dlp': { count: 1, mb: 87 }, ffmpeg: { count: 2, mb: 40 } }), 'yt-dlp 1× 87 MB · ffmpeg 2× 40 MB');
  assert.equal(describeTotal({ nodeMb: 100, helpersMb: 100 }), '✅ Total ≈ 200 MB of 512 MB (39%)');
  assert.match(describeTotal({ nodeMb: 200, helpersMb: 170 }), /^🟡/);
  assert.match(describeTotal({ nodeMb: 300, helpersMb: 200 }), /^⚠️ Total ≈ 500 MB of 512 MB \(98%\)/);
  assert.match(describeTotal({ nodeMb: 300, helpersMb: 100, limitMb: 1024 }), /39%/);
});

test('buildStats shows helpers and the total only when provided (old output unchanged)', () => {
  const base = { uptime: 4, memory: { rss: 1048576, heapUsed: 1, heapTotal: 2 }, guildCount: 1, activeConnections: 0, ytdlpVersion: '1', nodeVersion: 'v', discordVersion: '14', voiceVersion: '0.19' };
  assert.doesNotMatch(buildStats(base), /Helpers/);
  const full = buildStats({ ...base, helpersLine: 'ffmpeg 1× 20 MB', totalLine: '✅ Total ≈ 120 MB of 512 MB (23%)' });
  assert.match(full, /Helpers: ffmpeg 1× 20 MB/);
  assert.match(full, /Total ≈ 120 MB/);
});

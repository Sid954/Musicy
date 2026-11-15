const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const stats = require('../src/music/listening-stats');
const { createJsonStore } = require('../src/json-store');

const track = (n, extra = {}) => ({ title: `Song ${n}`, url: `https://www.youtube.com/watch?v=vid${String(n).padStart(8, '0')}`, requestedById: 'u1', ...extra });

test('recordPlay counts plays per track (by video id) and per requester', () => {
  const data = {};
  stats.applyPlay(data, 'g', track(1), 100);
  stats.applyPlay(data, 'g', track(1, { url: 'https://youtu.be/vid00000001' }), 200); // same video, other URL shape
  stats.applyPlay(data, 'g', track(2, { requestedById: 'u2' }), 300);
  stats.applyPlay(data, 'other', track(9), 400);
  assert.equal(data.g.totalPlays, 3);
  const top = stats.rankTracks(data, 'g');
  assert.deepEqual(top.map((t) => [t.title, t.plays]), [['Song 1', 2], ['Song 2', 1]]);
  assert.deepEqual(stats.rankUsers(data, 'g').map((u) => [u.id, u.plays]), [['u1', 2], ['u2', 1]]);
  assert.equal(stats.summarize(data, 'other').totalPlays, 1, 'servers are independent');
  assert.deepEqual(stats.summarize(data, 'none'), { totalPlays: 0, totalSeconds: 0, uniqueTracks: 0, listeners: 0 });
});

test('recordListen adds seconds to the server and the requester and ignores junk', () => {
  const data = {};
  stats.applyListen(data, 'g', 'u1', 180);
  stats.applyListen(data, 'g', 'u1', 60.4);
  stats.applyListen(data, 'g', 'u2', 0);
  stats.applyListen(data, 'g', 'u2', NaN);
  stats.applyListen(data, 'g', 'u2', -5);
  stats.applyListen(data, 'g', undefined, 100);
  assert.equal(data.g.totalSeconds, 340);
  assert.equal(data.g.users.u1.seconds, 240);
  assert.equal(data.g.users.u2, undefined);
});

test('data is bounded: only the most played tracks and users are kept', () => {
  const data = {};
  for (let n = 0; n < stats.MAX_TRACKS + 50; n++) stats.applyPlay(data, 'g', track(n, { requestedById: `user${n}` }), n);
  for (let k = 0; k < 5; k++) stats.applyPlay(data, 'g', track(7, { requestedById: 'user7' }), 10_000 + k);
  assert.equal(Object.keys(data.g.tracks).length, stats.MAX_TRACKS);
  assert.equal(Object.keys(data.g.users).length, stats.MAX_USERS);
  assert.equal(stats.rankTracks(data, 'g')[0].title, 'Song 7', 'the most played survives trimming');
  assert.equal(data.g.totalPlays, stats.MAX_TRACKS + 55, 'totals still count everything');
});

test('the persistent singleton never writes to disk unless load() was called', async () => {
  const before = await fs.stat(path.join(__dirname, '..', 'data', 'stats.json')).then((s) => s.mtimeMs, () => null);
  stats.recordPlay('test-guild', track(1));
  await stats.flush();
  const after = await fs.stat(path.join(__dirname, '..', 'data', 'stats.json')).then((s) => s.mtimeMs, () => null);
  assert.equal(after, before);
});

test('json store: load, atomic save via flush, reload, and corrupt-file backup', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jsonstore-'));
  const file = path.join(dir, 'nested', 'data.json');
  const store = createJsonStore({ filePath: file, debounceMs: 10_000 });
  store.mutate((d) => { d.x = 1; });
  await store.flush();
  await assert.rejects(fs.stat(file), 'not loaded yet: nothing written');
  await store.load();
  assert.deepEqual(store.get(), {});
  store.mutate((d) => { d.a = { n: 1 }; });
  store.mutate((d) => ({ ...d, b: 2 }));
  await store.flush();
  const again = createJsonStore({ filePath: file });
  await again.load();
  assert.deepEqual(again.get(), { a: { n: 1 }, b: 2 });
  assert.deepEqual((await fs.readdir(path.dirname(file))).filter((f) => f.endsWith('.tmp')), []);

  await fs.writeFile(file, '{not json', 'utf8');
  const broken = createJsonStore({ filePath: file });
  await broken.load();
  assert.deepEqual(broken.get(), {});
  assert.equal(await fs.readFile(`${file}.bad`, 'utf8'), '{not json');
  await fs.writeFile(file, '[1,2]', 'utf8');
  const wrongShape = createJsonStore({ filePath: file });
  await wrongShape.load();
  assert.deepEqual(wrongShape.get(), {});
  await fs.rm(dir, { recursive: true, force: true });
});

test('json store debounces: many mutations produce one write after the delay', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jsonstore-'));
  const file = path.join(dir, 'd.json');
  const store = createJsonStore({ filePath: file, debounceMs: 30 });
  await store.load();
  for (let n = 0; n < 20; n++) store.mutate((d) => { d.count = n; });
  assert.equal(await fs.stat(file).then(() => true, () => false), false, 'not written immediately');
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).count, 19);
  await fs.rm(dir, { recursive: true, force: true });
});

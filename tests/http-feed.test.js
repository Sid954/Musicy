const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { createHttpFeed } = require('../src/music/http-feed');

const DATA = crypto.randomBytes(1_000_000);

function serve(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/audio`, close: () => new Promise((done) => { server.closeAllConnections?.(); server.close(done); }) }));
  });
}

const rangeOf = (req) => {
  const match = /bytes=(\d+)-(\d+)?/.exec(req.headers.range || '');
  return match ? [Number(match[1]), match[2] ? Math.min(Number(match[2]), DATA.length - 1) : DATA.length - 1] : null;
};

async function readAll(stream) {
  const parts = [];
  for await (const part of stream) parts.push(part);
  return Buffer.concat(parts);
}

test('fetches a file in ranged chunks and reassembles it exactly', async () => {
  const requests = [];
  const s = await serve((req, res) => {
    const range = rangeOf(req);
    requests.push(req.headers.range);
    if (!range) { res.writeHead(200); return res.end(DATA); }
    res.writeHead(206, { 'content-range': `bytes ${range[0]}-${range[1]}/${DATA.length}`, 'content-length': range[1] - range[0] + 1 });
    res.end(DATA.subarray(range[0], range[1] + 1));
  });
  const data = await readAll(createHttpFeed(s.url, { chunk: 300_000 }));
  await s.close();
  assert.ok(data.equals(DATA));
  assert.deepEqual(requests, ['bytes=0-299999', 'bytes=300000-599999', 'bytes=600000-899999', 'bytes=900000-1199999']);
});

test('resumes from the byte it reached when a connection drops in the middle of a chunk', async () => {
  let dropped = false;
  const starts = [];
  const s = await serve((req, res) => {
    const range = rangeOf(req);
    starts.push(range[0]);
    res.writeHead(206, { 'content-range': `bytes ${range[0]}-${range[1]}/${DATA.length}`, 'content-length': range[1] - range[0] + 1 });
    if (!dropped && range[0] === 200_000) {
      dropped = true;
      res.write(DATA.subarray(range[0], range[0] + 50_000));
      return setTimeout(() => res.destroy(), 20); // connection dies after 50 kB
    }
    res.end(DATA.subarray(range[0], range[1] + 1));
  });
  const data = await readAll(createHttpFeed(s.url, { chunk: 200_000, retryDelayMs: 10 }));
  await s.close();
  assert.ok(data.equals(DATA), 'no bytes lost or repeated');
  assert.ok(starts.includes(250_000), `asked again from where it stopped: ${starts}`);
});

test('a server that ignores ranges (200) is streamed whole', async () => {
  const s = await serve((req, res) => { res.writeHead(200); res.end(DATA); });
  const data = await readAll(createHttpFeed(s.url, { chunk: 100_000 }));
  await s.close();
  assert.ok(data.equals(DATA));
});

test('gives up with a clear error after repeated failures and on HTTP errors', async () => {
  const gone = await serve((req, res) => { res.writeHead(403); res.end(); });
  await assert.rejects(readAll(createHttpFeed(gone.url)), /HTTP 403/);
  await gone.close();
  const flaky = await serve((req, res) => res.destroy());
  await assert.rejects(readAll(createHttpFeed(flaky.url, { retries: 1, retryDelayMs: 5 })));
  await flaky.close();
});

test('live mode makes one plain request without a range', async () => {
  const seen = [];
  const s = await serve((req, res) => { seen.push(req.headers.range); res.writeHead(200, { 'content-type': 'audio/mpeg' }); res.end(DATA.subarray(0, 4000)); });
  const data = await readAll(createHttpFeed(s.url, { live: true }));
  await s.close();
  assert.equal(data.length, 4000);
  assert.deepEqual(seen, [undefined]);
});

test('destroying the feed (skip/stop) aborts the download', async () => {
  let closed = false;
  const s = await serve((req, res) => {
    res.writeHead(200);
    res.on('close', () => { closed = true; });
    const timer = setInterval(() => res.write(Buffer.alloc(1000)), 5);
    res.on('close', () => clearInterval(timer));
  });
  const feed = createHttpFeed(s.url, { live: true });
  await new Promise((resolve) => feed.once('data', resolve));
  feed.destroy();
  for (let waited = 0; waited < 2000 && !closed; waited += 20) await new Promise((resolve) => setTimeout(resolve, 20));
  await s.close();
  assert.equal(closed, true);
});

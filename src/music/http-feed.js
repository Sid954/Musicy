// Downloads audio over HTTP(S) in Node and hands it to ffmpeg through a pipe.
//
// Why: the static ffmpeg we ship crashes with SIGSEGV on some Linux hosts whenever it has to resolve a host name
// (reproduced: even `ffmpeg -i http://example.com/` segfaults, while piped or local input works). Node's own
// networking is fine, so ffmpeg never touches the network.
//
// Songs are fetched in ranged chunks (what browsers and yt-dlp do): no long-lived connection for YouTube to drop,
// and a failed chunk is simply asked for again from the same byte. Live streams are one plain GET.
const { Readable } = require('stream');

const DEFAULT_CHUNK = 4 * 1024 * 1024;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function totalFromContentRange(value) {
  const match = /\/(\d+)\s*$/.exec(String(value || ''));
  return match ? Number(match[1]) : null;
}

// Returns a Readable of the audio bytes. `live: true` = endless stream (single request, no ranges).
function createHttpFeed(url, { live = false, chunk = DEFAULT_CHUNK, retries = 3, retryDelayMs = 500, signal, fetchImpl = globalThis.fetch, headers = {}, timeoutMs = 20_000, onRetry = () => {} } = {}) {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const baseHeaders = { 'user-agent': USER_AGENT, accept: '*/*', ...headers };

  // A connection that stops delivering bytes counts as failed instead of hanging the song.
  async function* body(response) {
    const reader = response.body.getReader();
    try {
      for (;;) {
        let timer;
        const stalled = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('The audio download stalled.')), timeoutMs); });
        let step;
        try { step = await Promise.race([reader.read(), stalled]); } finally { clearTimeout(timer); }
        if (step.done) return;
        yield Buffer.from(step.value);
      }
    } finally {
      try { await reader.cancel(); } catch { /* already closed */ }
    }
  }

  async function* generate() {
    if (live) {
      const response = await fetchImpl(url, { headers: baseHeaders, signal: controller.signal, redirect: 'follow' });
      if (!response.ok) throw new Error(`The stream answered HTTP ${response.status}.`);
      yield* body(response);
      return;
    }
    let offset = 0;
    let total = null;
    let failures = 0;
    while (total === null || offset < total) {
      const end = offset + chunk - 1;
      let response;
      try {
        response = await fetchImpl(url, { headers: { ...baseHeaders, range: `bytes=${offset}-${end}` }, signal: controller.signal, redirect: 'follow' });
      } catch (error) {
        if (controller.signal.aborted || ++failures > retries) throw error;
        onRetry({ reason: `request failed: ${error.cause?.code || error.message}`, offset, attempt: failures });
        await sleep(retryDelayMs);
        continue;
      }
      if (response.status === 200) {
        // The server ignored the range and sends the whole file: only valid from the start.
        if (offset > 0) throw new Error('The server does not support resuming the download.');
        yield* body(response);
        return;
      }
      if (response.status !== 206) {
        try { await response.body?.cancel(); } catch { /* ignore */ }
        if (response.status === 416 && total !== null) return; // asked past the end
        if (controller.signal.aborted || ++failures > retries || response.status < 500) throw new Error(`The audio server answered HTTP ${response.status}.`);
        onRetry({ reason: `HTTP ${response.status}`, offset, attempt: failures });
        await sleep(retryDelayMs);
        continue;
      }
      total = totalFromContentRange(response.headers.get('content-range')) ?? total;
      let received = 0;
      try {
        for await (const part of body(response)) {
          received += part.length;
          offset += part.length;
          yield part;
        }
      } catch (error) {
        if (controller.signal.aborted || ++failures > retries) throw error;
        onRetry({ reason: error.message, offset, attempt: failures });
        await sleep(retryDelayMs);
        continue; // ask again from the byte we reached
      }
      if (received === 0) {
        if (++failures > retries) throw new Error('The audio server returned no data.');
        await sleep(retryDelayMs);
      } else if (total === null) {
        return; // unknown length and the chunk was short: assume that was the end
      } else {
        failures = 0;
      }
    }
  }

  const feed = Readable.from(generate(), { objectMode: false });
  feed.once('close', () => { signal?.removeEventListener('abort', onAbort); controller.abort(); });
  return feed;
}

module.exports = { createHttpFeed, DEFAULT_CHUNK };

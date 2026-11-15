const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough, Transform } = require('node:stream');
const { wireStreamProcesses } = require('../src/music/sources/stream-process');

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.exitCode = null;
  child.kill = () => { child.exitCode = -9; };
  return child;
}

test('yt-dlp failure reaches the returned output stream with the classified error', async () => {
  const ff = fakeChild();
  const dl = fakeChild();
  const output = new Transform({ transform(chunk, _encoding, callback) { callback(null, chunk); } });
  const kill = wireStreamProcesses({ ff, dl, output, makeError: (_stderr, code) => Object.assign(new Error('unavailable'), { code: code === 1 ? 'UNAVAILABLE' : 'UNKNOWN' }), killChild: (child) => { if (child) child.kill(); } });
  const error = new Promise((resolve) => output.once('error', resolve));
  dl.stderr.write('Private video');
  dl.emit('close', 1);
  const emitted = await Promise.race([error, new Promise((_resolve, reject) => setTimeout(() => reject(new Error('stream error timed out')), 100))]);
  assert.equal(emitted.code, 'UNAVAILABLE');
  kill();
  assert.equal(output.destroyed, true);
});

test('ffmpeg clean close ends returned stream and failed close errors it', async () => {
  const ff = fakeChild();
  const output = new Transform({ transform(chunk, _encoding, callback) { callback(null, chunk); } });
  wireStreamProcesses({ ff, output, makeError: () => new Error('unused'), killChild: () => {} });
  const ended = new Promise((resolve) => output.once('end', resolve));
  output.resume();
  ff.emit('close', 0);
  await ended;

  const failedFf = fakeChild();
  const failedOutput = new Transform({ transform(chunk, _encoding, callback) { callback(null, chunk); } });
  wireStreamProcesses({ ff: failedFf, output: failedOutput, makeError: () => new Error('unused'), killChild: () => {} });
  const failure = new Promise((resolve) => failedOutput.once('error', resolve));
  failedFf.emit('close', 2);
  assert.match((await failure).message, /ffmpeg exited with code 2/);
});

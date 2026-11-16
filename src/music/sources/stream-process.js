function destroyOutput(output, error) {
  if (!output.destroyed && !output.readableEnded) output.destroy(error);
}

function wireFfmpegOutput({ ff, output, killChild }) {
  ff.stdout.pipe(output, { end: false });
  // Errors on the source side of pipe() do not automatically reach the destination.
  ff.stdout.on('error', (error) => {
    killChild?.(ff);
    destroyOutput(output, error);
  });
  ff.on('error', (error) => {
    killChild?.(ff);
    destroyOutput(output, error);
  });
  ff.on('close', (code, signal) => {
    if (code === 0) {
      if (!output.destroyed && !output.writableEnded) output.end();
    } else {
      killChild?.(ff);
      const why = String(ff.stderrText || '').trim().split('\n').filter(Boolean).pop();
      destroyOutput(output, new Error(`ffmpeg exited with code ${code}${signal ? ` (${signal})` : ''}${why ? `: ${why.slice(0, 200)}` : ''}`));
    }
  });
  output.on('error', () => {});
}

function wireYtdlpInput({ dl, ff, output, makeError, killChild }) {
  dl.stdout.pipe(ff.stdin);
  dl.stdout.on('error', (error) => {
    killChild(dl);
    killChild(ff);
    destroyOutput(output, error);
  });
  ff.stdin.on('error', () => {});
  dl.stderr.on('data', (chunk) => { dl.stderrText = `${dl.stderrText || ''}${chunk}`; });
  dl.on('error', (error) => {
    killChild(ff);
    destroyOutput(output, error);
  });
  dl.on('close', (code) => {
    if (code !== 0) {
      killChild(ff);
      destroyOutput(output, makeError(dl.stderrText || '', code));
    }
  });
}

function wireStreamProcesses({ ff, dl, output, makeError, killChild }) {
  wireFfmpegOutput({ ff, output, killChild });
  if (dl) wireYtdlpInput({ dl, ff, output, makeError, killChild });
  let killed = false;
  return function kill() {
    if (killed) return;
    killed = true;
    killChild(dl);
    killChild(ff);
    destroyOutput(output);
  };
}

module.exports = { wireFfmpegOutput, wireYtdlpInput, wireStreamProcesses };

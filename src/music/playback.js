function shouldRetryStream({ error, outputBytes, alreadyRetried = false }) {
  return !alreadyRetried && outputBytes === 0 && Boolean(error);
}

module.exports = { shouldRetryStream };

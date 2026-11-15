async function flushStoresWithTimeout(stores, timeoutMs = 5000) {
  let timer;
  let timedOut = false;
  const flush = Promise.allSettled(stores.map((store) => Promise.resolve().then(() => (store.flush || store.flushQueues).call(store))));
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => { timedOut = true; resolve({ timedOut: true }); }, timeoutMs);
  });
  const result = await Promise.race([flush.then((settled) => ({ timedOut: false, settled })), timeout]);
  clearTimeout(timer);
  return result;
}

module.exports = { flushStoresWithTimeout };

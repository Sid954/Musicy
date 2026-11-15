const test = require('node:test');
const assert = require('node:assert/strict');
const { validateEnqueue } = require('../src/music/queue-policy');

test('queue policy enforces configured queue and track duration caps', () => {
  assert.equal(validateEnqueue({ queuedCount: 2, incoming: [{ duration: 60 }], maxQueueLength: 3, maxTrackDuration: 120 }), true);
  assert.throws(() => validateEnqueue({ queuedCount: 3, incoming: [{ duration: 60 }], maxQueueLength: 3 }), /queue limit/);
  assert.throws(() => validateEnqueue({ queuedCount: 0, incoming: [{ title: 'Long', duration: 121 }], maxTrackDuration: 120 }), /track limit/);
  assert.equal(validateEnqueue({ queuedCount: 0, incoming: [{ duration: 0 }], maxTrackDuration: 60 }), true);
});

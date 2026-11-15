const test = require('node:test');
const assert = require('node:assert/strict');
const { queuePositionChoices, respondQueuePositions, MAX_CHOICES } = require('../src/music/queue-position-autocomplete');

const tracks = Array.from({ length: 80 }, (_, i) => ({ title: `Song ${i + 1}` }));

test('queue position autocomplete filters by typed number or title and caps choices', () => {
  assert.deepEqual(queuePositionChoices(tracks, '52'), [{ name: '52. Song 52', value: 52 }]);
  assert.equal(queuePositionChoices(tracks, 'song').length, 25);
  assert.equal(queuePositionChoices(tracks, '').length, MAX_CHOICES);
  assert.ok(queuePositionChoices(tracks, '').every(({ name }) => name.length <= 100));
  assert.deepEqual(queuePositionChoices([], ''), []);
});

test('remove, move and skipto command autocomplete delegates to in-memory choices; seek stays unchanged', async () => {
  const musicPath = require.resolve('../src/music/player');
  const previous = require.cache[musicPath];
  require.cache[musicPath] = { id: musicPath, filename: musicPath, loaded: true, exports: { getQueue: () => ({ tracks }) } };
  try {
    for (const name of ['remove', 'move', 'skipto']) {
      const commandPath = require.resolve(`../src/commands/${name}`);
      const oldCommand = require.cache[commandPath];
      delete require.cache[commandPath];
      const command = require(commandPath);
      let response;
      await command.autocomplete({ guildId: 'g', options: { getFocused: () => 'Song 2' }, async respond(value) { response = value; } });
      assert.ok(response.length > 0, name);
      if (oldCommand) require.cache[commandPath] = oldCommand; else delete require.cache[commandPath];
    }
    const seek = require('../src/commands/seek');
    assert.equal(seek.autocomplete, undefined);
  } finally {
    if (previous) require.cache[musicPath] = previous; else delete require.cache[musicPath];
  }
});

test('autocomplete reads in-memory queue and responds with bounded choices', async () => {
  const musicPath = require.resolve('../src/music/player');
  const previous = require.cache[musicPath];
  require.cache[musicPath] = { id: musicPath, filename: musicPath, loaded: true, exports: { getQueue: () => ({ tracks }) } };
  try {
    let response;
    await respondQueuePositions({ guildId: 'g', options: { getFocused: () => 'Song 1' }, async respond(value) { response = value; } });
    assert.ok(response.length <= 25);
    assert.ok(response.every((choice) => Number.isInteger(choice.value) && choice.name.length <= 100));
  } finally {
    if (previous) require.cache[musicPath] = previous; else delete require.cache[musicPath];
  }
});

const fs = require('node:fs');
const path = require('node:path');

module.exports = fs
  .readdirSync(__dirname)
  .filter((file) => file.endsWith('.js') && file !== 'index.js' && !file.startsWith('_'))
  .sort()
  .map((file) => require(path.join(__dirname, file)));

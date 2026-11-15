require('dotenv').config();
const { REST, Routes } = require('discord.js');
const commands = require('./commands');
const log = require('./log');

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !CLIENT_ID) {
  log.error('Set DISCORD_TOKEN and CLIENT_ID in .env');
  process.exit(1);
}

const rest = new REST().setToken(DISCORD_TOKEN);
const route = GUILD_ID ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID) : Routes.applicationCommands(CLIENT_ID);
rest
  .put(route, { body: commands.map((c) => c.data.toJSON()) })
  .then(() => log.info(`Registered ${commands.length} commands ${GUILD_ID ? '(guild)' : '(global)'}`))
  .catch((e) => { log.error(e); process.exit(1); });

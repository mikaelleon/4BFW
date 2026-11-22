import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { commands } from './commands/index.js';

const { DISCORD_TOKEN, CLIENT_ID, DEV_GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error('Set DISCORD_TOKEN and CLIENT_ID in .env first.');
  process.exit(1);
}

const body = [...commands.values()].map((c) => c.data.toJSON());
const rest = new REST().setToken(DISCORD_TOKEN);

if (DEV_GUILD_ID) {
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, DEV_GUILD_ID), { body });
  console.log(`Registered ${body.length} commands to guild ${DEV_GUILD_ID} (guild commands do not work in DMs).`);
} else {
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body });
  console.log(`Registered ${body.length} global commands (may take a while to appear).`);
}

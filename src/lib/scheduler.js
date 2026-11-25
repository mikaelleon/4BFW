// Background jobs, once a minute: lift timed bans whose time is up, post the confession of the day / week.
import * as db from '../db.js';
import { runHighlights } from './highlights.js';
import { dmUser, notice, systemLog } from './moderation.js';

const INTERVAL_MS = 60_000;

async function sweepBans(client) {
  for (const ban of db.takeExpiredBans()) {
    const guild = client.guilds.cache.get(ban.guild_id);
    if (!guild) continue; // bot left the server: the ban row is simply gone
    await dmUser(client, ban.user_id, notice(`Ban lifted in ${guild.name}`, 'Your timed ban has ended. You can post again. Please follow the rules.'));
    await systemLog(guild, 'Timed ban expired', `The ban on sender ||${ban.user_id}|| has ended.`);
  }
}

export function startScheduler(client) {
  const tick = () => {
    sweepBans(client).catch((err) => console.error('Ban sweep failed:', err));
    runHighlights(client).catch((err) => console.error('Highlights failed:', err));
  };
  tick();
  setInterval(tick, INTERVAL_MS).unref();
}

// Background jobs, once a minute: lift timed bans whose time is up, close polls that ran out, post the
// confession of the day / week,
// and (hourly) apply each server's data-retention period.
import * as db from '../db.js';
import { sweepPolls } from './engagement.js';
import { runHighlights } from './highlights.js';
import { dmUser, notice, systemLog } from './moderation.js';

const INTERVAL_MS = 60_000;
const PURGE_EVERY_MS = 60 * 60_000;
let lastPurge = 0;

async function sweepBans(client) {
  for (const ban of db.takeExpiredBans()) {
    const guild = client.guilds.cache.get(ban.guild_id);
    if (!guild) continue; // bot left the server: the ban row is simply gone
    await dmUser(client, ban.dm_id, notice(`Ban lifted in ${guild.name}`, 'Your timed ban has ended. You can post again. Please follow the rules.'));
    await systemLog(guild, 'Timed ban expired', `A timed ban has ended${ban.dm_id ? ` (sender ||${ban.dm_id}||)` : ''}.`);
  }
}

export function startScheduler(client) {
  const tick = () => {
    sweepBans(client).catch((err) => console.error('Ban sweep failed:', err));
    runHighlights(client).catch((err) => console.error('Highlights failed:', err));
    sweepPolls(client).catch((err) => console.error('Poll sweep failed:', err));
    // Data retention (/setup options retention_days): hourly is plenty, the periods are measured in days.
    if (Date.now() - lastPurge >= PURGE_EVERY_MS) {
      lastPurge = Date.now();
      try {
        const n = db.purgeExpired();
        if (n) console.log(`Retention: purged the sender ID, text and image of ${n} post(s).`);
      } catch (err) {
        console.error('Retention purge failed:', err);
      }
    }
  };
  tick();
  setInterval(tick, INTERVAL_MS).unref();
}

// Background jobs, once a minute: lift timed bans whose time is up, close polls that ran out, post saved submissions
// once posting resumes, post the confession of the day / week,
// and (hourly) apply each server's data-retention and image-cleanup periods.
import * as db from '../db.js';
import { releaseScheduled } from './confession.js';
import { sweepPolls } from './engagement.js';
import { runHighlights } from './highlights.js';
import { dmUser, notice, systemLog } from './moderation.js';

const INTERVAL_MS = 60_000;
const PURGE_EVERY_MS = 60 * 60_000;
let lastPurge = 0;

async function sweepBans(client) {
  for (const ban of await db.takeExpiredBans()) {
    const guild = client.guilds.cache.get(ban.guild_id);
    if (!guild) continue; // bot left the server: the ban row is simply gone
    await dmUser(client, ban.dm_id, notice(`Ban lifted in ${guild.name}`, 'Your timed ban has ended. You can post again. Please follow the rules.'));
    await systemLog(guild, 'Timed ban expired', 'A timed ban has ended.');
  }
}

/** Servers with saved submissions: post them if posting is open again. */
async function sweepScheduled(client) {
  for (const guildId of await db.guildsWithScheduled()) {
    const guild = client.guilds.cache.get(guildId);
    if (guild) releaseScheduled(guild).catch((err) => console.error(`Posting saved submissions failed for ${guildId}:`, err));
  }
}

// Data retention (/setup options retention_days) and image cleanup (image_days): hourly is plenty, the periods are
// measured in days.
async function sweepStorage() {
  if (Date.now() - lastPurge < PURGE_EVERY_MS) return;
  lastPurge = Date.now();
  const purged = await db.purgeExpired();
  if (purged) console.log(`Retention: purged the sender ID, text and image of ${purged} post(s).`);
  const images = await db.purgeOldImages();
  if (images) console.log(`Image cleanup: deleted ${images} stored image(s).`);
}

const JOBS = [
  ['Ban sweep', sweepBans],
  ['Highlights', runHighlights],
  ['Poll sweep', sweepPolls],
  ['Saved submissions', sweepScheduled],
  ['Storage cleanup', sweepStorage],
];

export function startScheduler(client) {
  const running = new Set(); // a slow database must not start a job again while it is still going
  const tick = () => {
    for (const [name, job] of JOBS) {
      if (running.has(name)) continue;
      running.add(name);
      Promise.resolve()
        .then(() => job(client))
        .catch((err) => console.error(`${name} failed:`, err))
        .finally(() => running.delete(name));
    }
  };
  tick();
  setInterval(tick, INTERVAL_MS).unref();
}

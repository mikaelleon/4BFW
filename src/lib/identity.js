// Pseudonymous user keys. Moderation records (warnings, bans, notes, votes, reports) are stored under a keyed hash of
// "<server>:<user>" instead of the raw Discord ID, so a copy of the database does not list who is who. The raw ID
// is kept only where the bot must DM the person (and is purged after the server's retention period).
import 'dotenv/config';
import { createHash, createHmac } from 'node:crypto';

const FROM_TOKEN = !process.env.ID_HASH_SECRET;
// Set ID_HASH_SECRET in .env and never change it: a different secret makes every stored key stop matching
// (bans and warnings would silently stop applying). Without it the secret is derived from the bot token.
const SECRET = process.env.ID_HASH_SECRET || createHash('sha256').update(`idkey:${process.env.DISCORD_TOKEN ?? 'dev'}`).digest('hex');

export const usesTokenSecret = () => FROM_TOKEN;

/** Short fingerprint of the secret, stored in the DB to notice when it changed. */
export const secretFingerprint = () => createHash('sha256').update(`fp:${SECRET}`).digest('hex').slice(0, 12);

const PREFIX = 'k_';
export const isKey = (value) => typeof value === 'string' && value.startsWith(PREFIX);

/** "k_<32 hex>" for this user in this server. */
export const userKey = (guildId, userId) =>
  PREFIX + createHmac('sha256', SECRET).update(`${guildId}:${userId}`).digest('hex').slice(0, 32);

/** Accepts a raw Discord ID or an existing key, returns the key. */
export const keyOf = (guildId, who) => (isKey(who) ? who : userKey(guildId, who));

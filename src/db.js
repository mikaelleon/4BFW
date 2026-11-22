import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';

mkdirSync('data', { recursive: true });
const db = new DatabaseSync('data/confessions.db');

db.exec(`
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS guilds (
  guild_id       TEXT PRIMARY KEY,
  channel_id     TEXT,
  log_channel_id TEXT,
  role_id        TEXT,
  sticky_id      TEXT,
  cooldown       INTEGER NOT NULL DEFAULT 30,
  warn_limit     INTEGER NOT NULL DEFAULT 3,
  welcome_dm     INTEGER NOT NULL DEFAULT 0,
  counter        INTEGER NOT NULL DEFAULT 0
);

-- id     = permanent, unique, admin-only (never reused, survives counter resets)
-- number = public "Anonymous #N" shown to everyone; admins can reset the counter
CREATE TABLE IF NOT EXISTS confessions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT NOT NULL,
  number     INTEGER NOT NULL,
  author_id  TEXT NOT NULL,
  channel_id TEXT,
  message_id TEXT,
  content    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'posted',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conf_author ON confessions (guild_id, author_id, created_at);
CREATE INDEX IF NOT EXISTS idx_conf_message ON confessions (guild_id, message_id);

CREATE TABLE IF NOT EXISTS warnings (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id          TEXT NOT NULL,
  user_id           TEXT NOT NULL,
  confession_id     INTEGER,
  reason            TEXT,
  created_at        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bans (
  guild_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  reason     TEXT,
  banned_by  TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);
`);

// One-time migration: the default cooldown dropped from 60s to 30s. Servers still on the old default move over;
// anyone who set another value keeps it. user_version stops this re-running (and overriding later choices).
let schemaVersion = db.prepare('PRAGMA user_version').get().user_version;
if (schemaVersion < 1) {
  db.exec('UPDATE guilds SET cooldown = 30 WHERE cooldown = 60; PRAGMA user_version = 1;');
  schemaVersion = 1;
}
// v2: remember whether a confession carried an image (shown in the mod log).
if (schemaVersion < 2) {
  db.exec('ALTER TABLE confessions ADD COLUMN has_image INTEGER NOT NULL DEFAULT 0; PRAGMA user_version = 2;');
  schemaVersion = 2;
}
// v3: optional moderator role that may use the mod-log buttons and /mod commands.
if (schemaVersion < 3) {
  db.exec('ALTER TABLE guilds ADD COLUMN mod_role_id TEXT; PRAGMA user_version = 3;');
}

/* ---------- guild config ---------- */

const GUILD_FIELDS = new Set([
  'channel_id', 'log_channel_id', 'role_id', 'mod_role_id', 'sticky_id', 'cooldown', 'warn_limit', 'welcome_dm',
]);

export function getGuild(guildId) {
  return db.prepare('SELECT * FROM guilds WHERE guild_id = ?').get(guildId);
}

export function updateGuild(guildId, fields) {
  db.prepare('INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)').run(guildId);
  for (const [key, value] of Object.entries(fields)) {
    if (!GUILD_FIELDS.has(key)) throw new Error(`Bad guild field: ${key}`);
    db.prepare(`UPDATE guilds SET ${key} = ? WHERE guild_id = ?`).run(value ?? null, guildId);
  }
  return getGuild(guildId);
}

export function configuredGuilds() {
  return db.prepare('SELECT * FROM guilds WHERE channel_id IS NOT NULL').all();
}

/* ---------- confessions ---------- */

export function createConfession(guildId, authorId, content, hasImage = false) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE guilds SET counter = counter + 1 WHERE guild_id = ?').run(guildId);
    const { counter } = db.prepare('SELECT counter FROM guilds WHERE guild_id = ?').get(guildId);
    const { lastInsertRowid } = db
      .prepare('INSERT INTO confessions (guild_id, number, author_id, content, has_image, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(guildId, counter, authorId, content, hasImage ? 1 : 0, Date.now());
    db.exec('COMMIT');
    return { id: Number(lastInsertRowid), number: counter };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** Undo a createConfession whose Discord post failed. Call only while holding the guild lock. */
export function discardConfession(guildId, id, number) {
  db.prepare('DELETE FROM confessions WHERE guild_id = ? AND id = ?').run(guildId, id);
  db.prepare('UPDATE guilds SET counter = counter - 1 WHERE guild_id = ? AND counter = ?').run(guildId, number);
}

export function setConfessionMessage(guildId, id, channelId, messageId) {
  db.prepare('UPDATE confessions SET channel_id = ?, message_id = ? WHERE guild_id = ? AND id = ?')
    .run(channelId, messageId, guildId, id);
}

/** Look up by the admin-only confession ID (scoped to the server). */
export function getConfession(guildId, id) {
  return db.prepare('SELECT * FROM confessions WHERE guild_id = ? AND id = ?').get(guildId, id);
}

/** Newest still-posted confession with this public number (numbers repeat after a reset). */
export function getLatestPostedByNumber(guildId, number) {
  return db
    .prepare(
      `SELECT * FROM confessions
       WHERE guild_id = ? AND number = ? AND status = 'posted' AND message_id IS NOT NULL AND channel_id IS NOT NULL
       ORDER BY id DESC LIMIT 1`,
    )
    .get(guildId, number);
}

export function getConfessionByMessage(guildId, messageId) {
  return db.prepare('SELECT * FROM confessions WHERE guild_id = ? AND message_id = ?').get(guildId, messageId);
}

export function markConfession(guildId, id, status) {
  db.prepare('UPDATE confessions SET status = ? WHERE guild_id = ? AND id = ?').run(status, guildId, id);
}

/** Restart the public numbering. The next confession gets `startAt` (default 1). IDs are untouched. */
export function resetCounter(guildId, startAt = 1) {
  db.prepare('INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)').run(guildId);
  db.prepare('UPDATE guilds SET counter = ? WHERE guild_id = ?').run(startAt - 1, guildId);
}

export function lastConfessionAt(guildId, userId) {
  const row = db
    .prepare('SELECT MAX(created_at) AS t FROM confessions WHERE guild_id = ? AND author_id = ?')
    .get(guildId, userId);
  return row?.t ?? 0;
}

/* ---------- warnings & bans ---------- */

export function addWarning(guildId, userId, confessionId, reason) {
  db.prepare(
    'INSERT INTO warnings (guild_id, user_id, confession_id, reason, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(guildId, userId, confessionId, reason ?? null, Date.now());
}

export function countWarnings(guildId, userId) {
  return db.prepare('SELECT COUNT(*) AS n FROM warnings WHERE guild_id = ? AND user_id = ?').get(guildId, userId).n;
}

export function clearWarnings(guildId, userId) {
  db.prepare('DELETE FROM warnings WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
}

export function banUser(guildId, userId, reason, bannedBy) {
  db.prepare(
    'INSERT OR REPLACE INTO bans (guild_id, user_id, reason, banned_by, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(guildId, userId, reason ?? null, bannedBy ?? null, Date.now());
}

export function unbanUser(guildId, userId) {
  return db.prepare('DELETE FROM bans WHERE guild_id = ? AND user_id = ?').run(guildId, userId).changes > 0;
}

export function getBan(guildId, userId) {
  return db.prepare('SELECT * FROM bans WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
}

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
  schemaVersion = 3;
}
// v4: role that gets an "I'm online" DM when the bot starts, and when the last one went out (anti-spam on restarts).
if (schemaVersion < 4) {
  db.exec('ALTER TABLE guilds ADD COLUMN online_role_id TEXT; ALTER TABLE guilds ADD COLUMN online_notified_at INTEGER; PRAGMA user_version = 4;');
  schemaVersion = 4;
}
// v5: keep each submission's image so the mod log can show it (also in later entries, after the post is deleted).
if (schemaVersion < 5) {
  db.exec(`CREATE TABLE IF NOT EXISTS confession_images (
    confession_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    data BLOB NOT NULL
  ); PRAGMA user_version = 5;`);
  schemaVersion = 5;
}
// v6: reports (anonymous: the reporter id is only used to count each person once), timed bans, warning expiry,
// mod notes, and what a post looked like when it was published (needed to restore a post that was auto-hidden).
if (schemaVersion < 6) {
  db.exec(`
    ALTER TABLE guilds ADD COLUMN report_limit INTEGER NOT NULL DEFAULT 3;
    ALTER TABLE guilds ADD COLUMN warn_expiry_days INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE bans ADD COLUMN expires_at INTEGER;
    ALTER TABLE confessions ADD COLUMN rendered TEXT;
    ALTER TABLE confessions ADD COLUMN color INTEGER;
    CREATE TABLE IF NOT EXISTS reports (
      confession_id INTEGER NOT NULL,
      reporter_id   TEXT NOT NULL,
      reason        TEXT,
      created_at    INTEGER NOT NULL,
      PRIMARY KEY (confession_id, reporter_id)
    );
    CREATE TABLE IF NOT EXISTS mod_notes (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id      TEXT NOT NULL,
      user_id       TEXT NOT NULL,
      confession_id INTEGER,
      note          TEXT NOT NULL,
      moderator_id  TEXT NOT NULL,
      created_at    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notes_user ON mod_notes (guild_id, user_id);
    PRAGMA user_version = 6;
  `);
}

// Last DM message id seen per user, so messages sent while the bot was offline can be found on startup.
db.exec('CREATE TABLE IF NOT EXISTS dm_cursor (user_id TEXT PRIMARY KEY, last_id TEXT NOT NULL)');

export function getDmCursor(userId) {
  return db.prepare('SELECT last_id FROM dm_cursor WHERE user_id = ?').get(userId)?.last_id ?? null;
}

export function setDmCursor(userId, lastId) {
  db.prepare('INSERT INTO dm_cursor (user_id, last_id) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET last_id = excluded.last_id').run(userId, lastId);
}

/** Everyone the bot has talked to: past authors plus anyone with a cursor. */
export function knownDmUsers() {
  return db
    .prepare('SELECT author_id AS id FROM confessions UNION SELECT user_id AS id FROM dm_cursor')
    .all()
    .map((r) => r.id);
}

/* ---------- guild config ---------- */

const GUILD_FIELDS = new Set([
  'channel_id', 'log_channel_id', 'role_id', 'mod_role_id', 'sticky_id', 'cooldown', 'warn_limit', 'welcome_dm',
  'online_role_id', 'online_notified_at', 'report_limit', 'warn_expiry_days',
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
  db.prepare('DELETE FROM confession_images WHERE confession_id = ?').run(id);
  db.prepare('DELETE FROM confessions WHERE guild_id = ? AND id = ?').run(guildId, id);
  db.prepare('UPDATE guilds SET counter = counter - 1 WHERE guild_id = ? AND counter = ?').run(guildId, number);
}

export function setConfessionImage(id, name, buffer) {
  db.prepare('INSERT OR REPLACE INTO confession_images (confession_id, name, data) VALUES (?, ?, ?)').run(id, name, buffer);
}

/** { name, buffer } or null. */
export function getConfessionImage(id) {
  const r = db.prepare('SELECT name, data FROM confession_images WHERE confession_id = ?').get(id);
  return r ? { name: r.name, buffer: Buffer.from(r.data) } : null;
}

/** What the public post looked like (text with links, color), so an auto-hidden post can be put back. */
export function setConfessionRendered(id, rendered, color) {
  db.prepare('UPDATE confessions SET rendered = ?, color = ? WHERE id = ?').run(rendered, color, id);
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

const DAY_MS = 86_400_000;

/** Warnings older than the server's warn_expiry_days (0 = never) no longer count towards the limit. */
function warningCutoff(guildId) {
  const days = getGuild(guildId)?.warn_expiry_days ?? 0;
  return days > 0 ? Date.now() - days * DAY_MS : 0;
}

/** Warnings that still count (not expired). */
export function countWarnings(guildId, userId) {
  return db
    .prepare('SELECT COUNT(*) AS n FROM warnings WHERE guild_id = ? AND user_id = ? AND created_at > ?')
    .get(guildId, userId, warningCutoff(guildId)).n;
}

/** Every warning ever given, newest first, with whether it has expired. */
export function listWarnings(guildId, userId) {
  const cutoff = warningCutoff(guildId);
  return db
    .prepare('SELECT * FROM warnings WHERE guild_id = ? AND user_id = ? ORDER BY id DESC')
    .all(guildId, userId)
    .map((w) => ({ ...w, expired: w.created_at <= cutoff }));
}

export function clearWarnings(guildId, userId) {
  db.prepare('DELETE FROM warnings WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
}

/** `expiresAt` = epoch ms when the ban lifts itself, or null for a permanent ban. */
export function banUser(guildId, userId, reason, bannedBy, expiresAt = null) {
  db.prepare(
    'INSERT OR REPLACE INTO bans (guild_id, user_id, reason, banned_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(guildId, userId, reason ?? null, bannedBy ?? null, Date.now(), expiresAt);
}

/** Remove and return every ban whose time is up (the scheduler tells the user and the mods). */
export function takeExpiredBans() {
  const now = Date.now();
  const rows = db.prepare('SELECT * FROM bans WHERE expires_at IS NOT NULL AND expires_at <= ?').all(now);
  if (rows.length) db.prepare('DELETE FROM bans WHERE expires_at IS NOT NULL AND expires_at <= ?').run(now);
  return rows;
}

export function unbanUser(guildId, userId) {
  return db.prepare('DELETE FROM bans WHERE guild_id = ? AND user_id = ?').run(guildId, userId).changes > 0;
}

/** The active ban, or undefined. A timed ban whose time has passed counts as lifted even before the scheduler runs. */
export function getBan(guildId, userId) {
  return db
    .prepare('SELECT * FROM bans WHERE guild_id = ? AND user_id = ? AND (expires_at IS NULL OR expires_at > ?)')
    .get(guildId, userId, Date.now());
}

/* ---------- reports ---------- */

/** True when this is a new report (each person can report a post once). */
export function addReport(confessionId, reporterId, reason) {
  return (
    db
      .prepare('INSERT OR IGNORE INTO reports (confession_id, reporter_id, reason, created_at) VALUES (?, ?, ?, ?)')
      .run(confessionId, reporterId, reason ?? null, Date.now()).changes > 0
  );
}

export function hasReported(confessionId, reporterId) {
  return Boolean(db.prepare('SELECT 1 FROM reports WHERE confession_id = ? AND reporter_id = ?').get(confessionId, reporterId));
}

export function countReports(confessionId) {
  return db.prepare('SELECT COUNT(*) AS n FROM reports WHERE confession_id = ?').get(confessionId).n;
}

export function clearReports(confessionId) {
  db.prepare('DELETE FROM reports WHERE confession_id = ?').run(confessionId);
}

/* ---------- mod notes & history ---------- */

export function addNote(guildId, userId, confessionId, note, moderatorId) {
  db.prepare(
    'INSERT INTO mod_notes (guild_id, user_id, confession_id, note, moderator_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(guildId, userId, confessionId, note, moderatorId, Date.now());
}

export function listNotes(guildId, userId) {
  return db.prepare('SELECT * FROM mod_notes WHERE guild_id = ? AND user_id = ? ORDER BY id DESC').all(guildId, userId);
}

export function listConfessionsByAuthor(guildId, userId) {
  return db.prepare('SELECT * FROM confessions WHERE guild_id = ? AND author_id = ? ORDER BY id DESC').all(guildId, userId);
}

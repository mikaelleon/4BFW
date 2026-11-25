import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { isKey, keyOf, secretFingerprint, userKey } from './lib/identity.js';

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
  schemaVersion = 6;
}
// v7: topic tags (+ per-tag channels), button reactions, polls, and "confession of the day/week" settings.
if (schemaVersion < 7) {
  db.exec(`
    ALTER TABLE confessions ADD COLUMN tag TEXT;
    ALTER TABLE confessions ADD COLUMN is_poll INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE guilds ADD COLUMN highlight_channel_id TEXT;
    ALTER TABLE guilds ADD COLUMN highlight_period TEXT NOT NULL DEFAULT 'off';
    ALTER TABLE guilds ADD COLUMN highlight_daily_at INTEGER;
    ALTER TABLE guilds ADD COLUMN highlight_weekly_at INTEGER;
    CREATE TABLE IF NOT EXISTS tag_channels (
      guild_id   TEXT NOT NULL,
      tag        TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      PRIMARY KEY (guild_id, tag)
    );
    -- one reaction per person per post: kind is 'up' or 'down' (hearts were removed in v12)
    CREATE TABLE IF NOT EXISTS reactions (
      confession_id INTEGER NOT NULL,
      user_id       TEXT NOT NULL,
      kind          TEXT NOT NULL,
      PRIMARY KEY (confession_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS poll_options (
      confession_id INTEGER NOT NULL,
      idx           INTEGER NOT NULL,
      label         TEXT NOT NULL,
      PRIMARY KEY (confession_id, idx)
    );
    -- one vote per person per poll
    CREATE TABLE IF NOT EXISTS poll_votes (
      confession_id INTEGER NOT NULL,
      user_id       TEXT NOT NULL,
      idx           INTEGER NOT NULL,
      PRIMARY KEY (confession_id, user_id)
    );
    PRAGMA user_version = 7;
  `);
  schemaVersion = 7;
}
// v8: the admin-facing Submission ID counts per server (1, 2, 3...) instead of across every server the bot is in.
// `id` stays the internal key; `sub_id` is what moderators see and type. Existing posts are numbered in posting order.
if (schemaVersion < 8) {
  db.exec(`
    ALTER TABLE confessions ADD COLUMN sub_id INTEGER;
    UPDATE confessions SET sub_id = (SELECT COUNT(*) FROM confessions c2 WHERE c2.guild_id = confessions.guild_id AND c2.id <= confessions.id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_conf_subid ON confessions (guild_id, sub_id);
    PRAGMA user_version = 8;
  `);
}
// v9: appeals against warnings (one per warning; the warning id is shown to the user as W-0042).
if (schemaVersion < 9) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS appeals (
      warning_id  INTEGER PRIMARY KEY,
      guild_id    TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      message     TEXT,
      status      TEXT NOT NULL DEFAULT 'open',
      resolved_by TEXT,
      created_at  INTEGER NOT NULL
    );
    PRAGMA user_version = 9;
  `);
  schemaVersion = 9;
}
// v10: privacy. Moderation records move from raw Discord IDs to keyed hashes (author_key, see lib/identity.js);
// the raw sender ID stays on a confession only until the server's retention period ends. Also: self-delete window,
// retention setting, and ban appeals (DM `fw appeal <text>`).
if (schemaVersion < 10) {
  db.exec('BEGIN');
  try {
    db.exec(`
      ALTER TABLE confessions ADD COLUMN author_key TEXT;
      ALTER TABLE confessions ADD COLUMN purged_at INTEGER;
      ALTER TABLE bans ADD COLUMN dm_id TEXT;
      ALTER TABLE guilds ADD COLUMN self_delete_minutes INTEGER NOT NULL DEFAULT 10;
      ALTER TABLE guilds ADD COLUMN retention_days INTEGER NOT NULL DEFAULT 0;
      CREATE TABLE IF NOT EXISTS ban_appeals (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id    TEXT NOT NULL,
        user_key    TEXT NOT NULL,
        dm_id       TEXT,
        message     TEXT,
        status      TEXT NOT NULL DEFAULT 'open',
        resolved_by TEXT,
        created_at  INTEGER NOT NULL,
        resolved_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_banappeal_user ON ban_appeals (guild_id, user_key);
    `);
    const each = (sql, fn) => db.prepare(sql).all().forEach(fn);
    each('SELECT id, guild_id, author_id FROM confessions', (r) =>
      db.prepare('UPDATE confessions SET author_key = ? WHERE id = ?').run(userKey(r.guild_id, r.author_id), r.id),
    );
    for (const table of ['warnings', 'mod_notes']) {
      each(`SELECT id, guild_id, user_id FROM ${table}`, (r) => {
        if (!isKey(r.user_id)) db.prepare(`UPDATE ${table} SET user_id = ? WHERE id = ?`).run(userKey(r.guild_id, r.user_id), r.id);
      });
    }
    each('SELECT guild_id, user_id, expires_at FROM bans', (r) => {
      if (isKey(r.user_id)) return;
      // Timed bans keep the raw ID (until the retention purge) so the bot can DM when the ban ends.
      db.prepare('UPDATE bans SET user_id = ?, dm_id = ? WHERE guild_id = ? AND user_id = ?').run(
        userKey(r.guild_id, r.user_id), r.expires_at ? r.user_id : null, r.guild_id, r.user_id,
      );
    });
    for (const [table, col] of [['reactions', 'user_id'], ['poll_votes', 'user_id'], ['reports', 'reporter_id']]) {
      each(`SELECT t.confession_id AS cid, t.${col} AS uid, c.guild_id AS gid FROM ${table} t JOIN confessions c ON c.id = t.confession_id`, (r) => {
        if (!isKey(r.uid)) db.prepare(`UPDATE ${table} SET ${col} = ? WHERE confession_id = ? AND ${col} = ?`).run(userKey(r.gid, r.uid), r.cid, r.uid);
      });
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  db.exec('PRAGMA user_version = 10');
  schemaVersion = 10;
}

// v11: auto-filter, optional approval queue, poll end/close, featured channel, content warnings, user preferences.
if (schemaVersion < 11) {
  db.exec(`
    ALTER TABLE confessions ADD COLUMN reply_to TEXT;
    ALTER TABLE confessions ADD COLUMN cw TEXT;
    ALTER TABLE confessions ADD COLUMN poll_hours INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE confessions ADD COLUMN poll_ends_at INTEGER;
    ALTER TABLE confessions ADD COLUMN poll_closed_at INTEGER;
    ALTER TABLE confessions ADD COLUMN hold_reason TEXT;
    ALTER TABLE confessions ADD COLUMN featured_channel_id TEXT;
    ALTER TABLE confessions ADD COLUMN featured_message_id TEXT;
    ALTER TABLE guilds ADD COLUMN approval_mode INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE guilds ADD COLUMN filter_action TEXT NOT NULL DEFAULT 'reject';
    ALTER TABLE guilds ADD COLUMN block_invites INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE guilds ADD COLUMN block_links INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE guilds ADD COLUMN poll_hours INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE guilds ADD COLUMN featured_channel_id TEXT;
    ALTER TABLE guilds ADD COLUMN featured_threshold INTEGER NOT NULL DEFAULT 5;
    CREATE TABLE IF NOT EXISTS filter_rules (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id   TEXT NOT NULL,
      kind       TEXT NOT NULL,
      pattern    TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_filter_guild ON filter_rules (guild_id);
    CREATE TABLE IF NOT EXISTS user_prefs (
      user_id    TEXT PRIMARY KEY,
      notify_off INTEGER NOT NULL DEFAULT 0,
      preview    INTEGER NOT NULL DEFAULT 0
    );
    PRAGMA user_version = 11;
  `);
  schemaVersion = 11;
}

// v12: the heart reaction is gone; drop the old ones so they stop counting anywhere.
if (schemaVersion < 12) {
  db.exec("DELETE FROM reactions WHERE kind = 'heart'; PRAGMA user_version = 12;");
  schemaVersion = 12;
}

// Remember which secret made the stored keys. If it changes, every ban and warning silently stops matching: say so.
db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
{
  const fp = secretFingerprint();
  const stored = db.prepare("SELECT value FROM meta WHERE key = 'idkey_fp'").get()?.value;
  if (!stored) db.prepare("INSERT INTO meta (key, value) VALUES ('idkey_fp', ?)").run(fp);
  else if (stored !== fp) {
    console.error(
      'WARNING: the ID hash secret is different from the one this database was written with (ID_HASH_SECRET or DISCORD_TOKEN changed).\n' +
        'Existing bans, warnings and notes will NOT match their users any more. Restore the old secret.',
    );
  }
}

// Last DM message id seen per user, so messages sent while the bot was offline can be found on startup.
db.exec('CREATE TABLE IF NOT EXISTS dm_cursor (user_id TEXT PRIMARY KEY, last_id TEXT NOT NULL)');

/** Write a consistent copy of the whole database to `path` (must not exist yet). Used by the backup job. */
export function snapshotTo(path) {
  db.exec(`VACUUM INTO '${path.replace(/'/g, "''")}'`);
}

export function getDmCursor(userId) {
  return db.prepare('SELECT last_id FROM dm_cursor WHERE user_id = ?').get(userId)?.last_id ?? null;
}

export function setDmCursor(userId, lastId) {
  db.prepare('INSERT INTO dm_cursor (user_id, last_id) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET last_id = excluded.last_id').run(userId, lastId);
}

/** Everyone the bot has talked to: past authors plus anyone with a cursor. */
export function knownDmUsers() {
  return db
    .prepare("SELECT author_id AS id FROM confessions WHERE author_id != '' UNION SELECT user_id AS id FROM dm_cursor")
    .all()
    .map((r) => r.id);
}

/* ---------- guild config ---------- */

const GUILD_FIELDS = new Set([
  'channel_id', 'log_channel_id', 'role_id', 'mod_role_id', 'sticky_id', 'cooldown', 'warn_limit', 'welcome_dm',
  'online_role_id', 'online_notified_at', 'report_limit', 'warn_expiry_days', 'highlight_channel_id', 'highlight_period',
  'highlight_daily_at', 'highlight_weekly_at', 'self_delete_minutes', 'retention_days', 'approval_mode', 'filter_action',
  'block_invites', 'block_links', 'poll_hours', 'featured_channel_id', 'featured_threshold',
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

/**
 * `extras` = { tag, pollOptions, pollHours, replyTo, cw, pending, holdReason } (all optional).
 * `pending` posts wait for a moderator: no public number yet (see assignNumber) and no poll end time yet.
 * Poll options are stored together with the confession.
 */
export function createConfession(guildId, authorId, content, hasImage = false, extras = {}) {
  db.exec('BEGIN IMMEDIATE');
  try {
    let counter = 0;
    if (!extras.pending) {
      db.prepare('UPDATE guilds SET counter = counter + 1 WHERE guild_id = ?').run(guildId);
      counter = db.prepare('SELECT counter FROM guilds WHERE guild_id = ?').get(guildId).counter;
    }
    const { next: subId } = db.prepare('SELECT COALESCE(MAX(sub_id), 0) + 1 AS next FROM confessions WHERE guild_id = ?').get(guildId);
    const isPoll = extras.pollOptions?.length ? 1 : 0;
    const pollHours = isPoll ? (extras.pollHours ?? 0) : 0;
    const now = Date.now();
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO confessions (guild_id, number, author_id, author_key, content, has_image, created_at, tag, is_poll, sub_id,
                                  status, reply_to, cw, poll_hours, poll_ends_at, hold_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        guildId, counter, authorId, keyOf(guildId, authorId), content, hasImage ? 1 : 0, now, extras.tag ?? null, isPoll, subId,
        extras.pending ? 'pending' : 'posted', extras.replyTo ?? null, extras.cw ?? null, pollHours,
        !extras.pending && pollHours > 0 ? now + pollHours * 3_600_000 : null, extras.holdReason ?? null,
      );
    extras.pollOptions?.forEach((label, idx) =>
      db.prepare('INSERT INTO poll_options (confession_id, idx, label) VALUES (?, ?, ?)').run(lastInsertRowid, idx, label),
    );
    db.exec('COMMIT');
    return { id: Number(lastInsertRowid), number: counter, subId };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** A moderator approved a pending post: give it the next public number and start its poll clock. Returns the number. */
export function assignNumber(guildId, id) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE guilds SET counter = counter + 1 WHERE guild_id = ?').run(guildId);
    const { counter } = db.prepare('SELECT counter FROM guilds WHERE guild_id = ?').get(guildId);
    const now = Date.now();
    db.prepare(
      "UPDATE confessions SET number = ?, status = 'posted', poll_ends_at = CASE WHEN poll_hours > 0 THEN ? + poll_hours * 3600000 ELSE NULL END WHERE guild_id = ? AND id = ?",
    ).run(counter, now, guildId, id);
    db.exec('COMMIT');
    return counter;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** Posting an approved submission failed: put it back in the queue and give the number back. */
export function revertAssign(guildId, id, number) {
  db.prepare('UPDATE guilds SET counter = counter - 1 WHERE guild_id = ? AND counter = ?').run(guildId, number);
  db.prepare("UPDATE confessions SET number = 0, status = 'pending', poll_ends_at = NULL WHERE guild_id = ? AND id = ?").run(guildId, id);
}

/** Undo a createConfession whose Discord post failed. Call only while holding the guild lock. */
export function discardConfession(guildId, id, number) {
  db.prepare('DELETE FROM confession_images WHERE confession_id = ?').run(id);
  db.prepare('DELETE FROM poll_options WHERE confession_id = ?').run(id);
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

/** Look up by the internal key (used inside button ids). Scoped to the server. */
export function getConfession(guildId, id) {
  return db.prepare('SELECT * FROM confessions WHERE guild_id = ? AND id = ?').get(guildId, id);
}

/** Look up by the Submission ID moderators see and type (counts per server). */
export function getConfessionBySubId(guildId, subId) {
  return db.prepare('SELECT * FROM confessions WHERE guild_id = ? AND sub_id = ?').get(guildId, subId);
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
    .prepare('SELECT MAX(created_at) AS t FROM confessions WHERE guild_id = ? AND author_key = ?')
    .get(guildId, keyOf(guildId, userId));
  return row?.t ?? 0;
}

/* ---------- warnings & bans ---------- */

/** Returns the new warning's id (shown to the user as W-0042). */
export function addWarning(guildId, userId, confessionId, reason) {
  const result = db
    .prepare('INSERT INTO warnings (guild_id, user_id, confession_id, reason, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(guildId, keyOf(guildId, userId), confessionId, reason ?? null, Date.now());
  return Number(result.lastInsertRowid);
}

export function getWarning(id) {
  return db.prepare('SELECT * FROM warnings WHERE id = ?').get(id);
}

export function deleteWarning(id) {
  return db.prepare('DELETE FROM warnings WHERE id = ?').run(id).changes > 0;
}

/* ---------- appeals ---------- */

export function addAppeal(warningId, guildId, userId, message) {
  db.prepare('INSERT INTO appeals (warning_id, guild_id, user_id, message, created_at) VALUES (?, ?, ?, ?, ?)').run(
    warningId, guildId, userId, message ?? null, Date.now(),
  );
}

export function getAppeal(warningId) {
  return db.prepare('SELECT * FROM appeals WHERE warning_id = ?').get(warningId);
}

export function resolveAppeal(warningId, status, resolvedBy) {
  db.prepare('UPDATE appeals SET status = ?, resolved_by = ? WHERE warning_id = ?').run(status, resolvedBy, warningId);
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
    .get(guildId, keyOf(guildId, userId), warningCutoff(guildId)).n;
}

/** Every warning ever given, newest first, with whether it has expired. */
export function listWarnings(guildId, userId) {
  const cutoff = warningCutoff(guildId);
  return db
    .prepare('SELECT * FROM warnings WHERE guild_id = ? AND user_id = ? ORDER BY id DESC')
    .all(guildId, keyOf(guildId, userId))
    .map((w) => ({ ...w, expired: w.created_at <= cutoff }));
}

export function clearWarnings(guildId, userId) {
  db.prepare('DELETE FROM warnings WHERE guild_id = ? AND user_id = ?').run(guildId, keyOf(guildId, userId));
}

/** `expiresAt` = epoch ms when the ban lifts itself, or null for a permanent ban. */
export function banUser(guildId, userId, reason, bannedBy, expiresAt = null, dmId = null) {
  // dm_id (raw ID) is kept only for timed bans, so the bot can DM when one ends. The retention purge clears it.
  const raw = expiresAt ? (dmId || (isKey(userId) ? null : userId)) : null;
  db.prepare(
    'INSERT OR REPLACE INTO bans (guild_id, user_id, reason, banned_by, created_at, expires_at, dm_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(guildId, keyOf(guildId, userId), reason ?? null, bannedBy ?? null, Date.now(), expiresAt, raw);
}

/** Remove and return every ban whose time is up (the scheduler tells the user and the mods). */
export function takeExpiredBans() {
  const now = Date.now();
  const rows = db.prepare('SELECT * FROM bans WHERE expires_at IS NOT NULL AND expires_at <= ?').all(now);
  if (rows.length) db.prepare('DELETE FROM bans WHERE expires_at IS NOT NULL AND expires_at <= ?').run(now);
  return rows;
}

export function unbanUser(guildId, userId) {
  return db.prepare('DELETE FROM bans WHERE guild_id = ? AND user_id = ?').run(guildId, keyOf(guildId, userId)).changes > 0;
}

/** The active ban, or undefined. A timed ban whose time has passed counts as lifted even before the scheduler runs. */
export function getBan(guildId, userId) {
  return db
    .prepare('SELECT * FROM bans WHERE guild_id = ? AND user_id = ? AND (expires_at IS NULL OR expires_at > ?)')
    .get(guildId, keyOf(guildId, userId), Date.now());
}

/* ---------- reports ---------- */

/** Reactions, votes and reports are stored under the person's key for that server, never the raw ID. */
function voterKey(confessionId, userId) {
  const guildId = db.prepare('SELECT guild_id FROM confessions WHERE id = ?').get(confessionId)?.guild_id ?? '';
  return keyOf(guildId, userId);
}

/** True when this is a new report (each person can report a post once). */
export function addReport(confessionId, reporterId, reason) {
  return (
    db
      .prepare('INSERT OR IGNORE INTO reports (confession_id, reporter_id, reason, created_at) VALUES (?, ?, ?, ?)')
      .run(confessionId, voterKey(confessionId, reporterId), reason ?? null, Date.now()).changes > 0
  );
}

export function hasReported(confessionId, reporterId) {
  return Boolean(
    db.prepare('SELECT 1 FROM reports WHERE confession_id = ? AND reporter_id = ?').get(confessionId, voterKey(confessionId, reporterId)),
  );
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
  ).run(guildId, keyOf(guildId, userId), confessionId, note, moderatorId, Date.now());
}

export function listNotes(guildId, userId) {
  return db.prepare('SELECT * FROM mod_notes WHERE guild_id = ? AND user_id = ? ORDER BY id DESC').all(guildId, keyOf(guildId, userId));
}

export function listConfessionsByAuthor(guildId, userId) {
  return db.prepare('SELECT * FROM confessions WHERE guild_id = ? AND author_key = ? ORDER BY id DESC').all(guildId, keyOf(guildId, userId));
}

/* ---------- topic channels ---------- */

export function getTagChannel(guildId, tag) {
  return db.prepare('SELECT channel_id FROM tag_channels WHERE guild_id = ? AND tag = ?').get(guildId, tag)?.channel_id ?? null;
}

export function setTagChannel(guildId, tag, channelId) {
  if (!channelId) db.prepare('DELETE FROM tag_channels WHERE guild_id = ? AND tag = ?').run(guildId, tag);
  else
    db.prepare(
      'INSERT INTO tag_channels (guild_id, tag, channel_id) VALUES (?, ?, ?) ON CONFLICT(guild_id, tag) DO UPDATE SET channel_id = excluded.channel_id',
    ).run(guildId, tag, channelId);
}

export function listTagChannels(guildId) {
  return db.prepare('SELECT tag, channel_id FROM tag_channels WHERE guild_id = ?').all(guildId);
}

/* ---------- reactions & polls (votes are never shown with a name, the user id only enforces one vote each) ---------- */

/** Click a reaction: same one again removes it, a different one switches. Returns the user's new reaction or null. */
export function toggleReaction(confessionId, userId, kind) {
  userId = voterKey(confessionId, userId);
  const current = db.prepare('SELECT kind FROM reactions WHERE confession_id = ? AND user_id = ?').get(confessionId, userId)?.kind;
  if (current === kind) {
    db.prepare('DELETE FROM reactions WHERE confession_id = ? AND user_id = ?').run(confessionId, userId);
    return null;
  }
  db.prepare(
    'INSERT INTO reactions (confession_id, user_id, kind) VALUES (?, ?, ?) ON CONFLICT(confession_id, user_id) DO UPDATE SET kind = excluded.kind',
  ).run(confessionId, userId, kind);
  return kind;
}

export function reactionCounts(confessionId) {
  const counts = { up: 0, down: 0 };
  for (const r of db.prepare('SELECT kind, COUNT(*) AS n FROM reactions WHERE confession_id = ? GROUP BY kind').all(confessionId)) {
    counts[r.kind] = r.n;
  }
  return counts;
}

export function getPollOptions(confessionId) {
  return db.prepare('SELECT idx, label FROM poll_options WHERE confession_id = ? ORDER BY idx').all(confessionId);
}

/** Vote for option `idx`; the same option again withdraws the vote. Returns the new choice or null. */
export function togglePollVote(confessionId, userId, idx) {
  userId = voterKey(confessionId, userId);
  const current = db.prepare('SELECT idx FROM poll_votes WHERE confession_id = ? AND user_id = ?').get(confessionId, userId)?.idx;
  if (current === idx) {
    db.prepare('DELETE FROM poll_votes WHERE confession_id = ? AND user_id = ?').run(confessionId, userId);
    return null;
  }
  db.prepare(
    'INSERT INTO poll_votes (confession_id, user_id, idx) VALUES (?, ?, ?) ON CONFLICT(confession_id, user_id) DO UPDATE SET idx = excluded.idx',
  ).run(confessionId, userId, idx);
  return idx;
}

/** Map of option idx -> votes. */
export function pollCounts(confessionId) {
  const counts = new Map();
  for (const r of db.prepare('SELECT idx, COUNT(*) AS n FROM poll_votes WHERE confession_id = ? GROUP BY idx').all(confessionId)) {
    counts.set(r.idx, r.n);
  }
  return counts;
}

/* ---------- highlights ---------- */

/** Most-liked post (👍, fewest 👎 breaks ties, then the older one) created at or after `since`. Null when nobody liked anything. */
export function topLikedSince(guildId, since) {
  return (
    db
      .prepare(
        `SELECT c.*,
                COALESCE(SUM(r.kind = 'up'), 0)   AS ups,
                COALESCE(SUM(r.kind = 'down'), 0) AS downs
           FROM confessions c LEFT JOIN reactions r ON r.confession_id = c.id
          WHERE c.guild_id = ? AND c.status = 'posted' AND c.created_at >= ? AND c.message_id IS NOT NULL AND c.purged_at IS NULL
          GROUP BY c.id
         HAVING ups > 0
          ORDER BY ups DESC, downs ASC, c.id ASC
          LIMIT 1`,
      )
      .get(guildId, since) ?? null
  );
}

export function guildsWithHighlights() {
  return db.prepare("SELECT * FROM guilds WHERE highlight_channel_id IS NOT NULL AND highlight_period != 'off'").all();
}

/* ---------- retention ---------- */

/**
 * For every server with a retention period: wipe the sender ID, text and image of posts older than that, and the raw
 * ID kept for timed-ban DMs. The row stays (IDs, numbers, status, key) so history, bans and warnings keep working.
 * Returns how many posts were purged.
 */
export function purgeExpired() {
  const now = Date.now();
  let purged = 0;
  for (const g of db.prepare('SELECT guild_id, retention_days FROM guilds WHERE retention_days > 0').all()) {
    const cutoff = now - g.retention_days * DAY_MS;
    db.exec('BEGIN');
    try {
      db.prepare(
        'DELETE FROM confession_images WHERE confession_id IN (SELECT id FROM confessions WHERE guild_id = ? AND created_at < ? AND purged_at IS NULL)',
      ).run(g.guild_id, cutoff);
      purged += db
        .prepare("UPDATE confessions SET author_id = '', content = '', rendered = NULL, purged_at = ? WHERE guild_id = ? AND created_at < ? AND purged_at IS NULL")
        .run(now, g.guild_id, cutoff).changes;
      db.prepare('UPDATE bans SET dm_id = NULL WHERE guild_id = ? AND created_at < ? AND dm_id IS NOT NULL').run(g.guild_id, cutoff);
      db.prepare("UPDATE ban_appeals SET dm_id = NULL, message = NULL WHERE guild_id = ? AND created_at < ? AND status != 'open'").run(g.guild_id, cutoff);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  return purged;
}

/* ---------- ban appeals (DM: fw appeal <text>) ---------- */

export function addBanAppeal(guildId, userId, message) {
  const r = db
    .prepare('INSERT INTO ban_appeals (guild_id, user_key, dm_id, message, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(guildId, keyOf(guildId, userId), userId, message, Date.now());
  return Number(r.lastInsertRowid);
}

export function getBanAppeal(id) {
  return db.prepare('SELECT * FROM ban_appeals WHERE id = ?').get(id);
}

/** The user's newest appeal in this server, or undefined. */
export function latestBanAppeal(guildId, userId) {
  return db.prepare('SELECT * FROM ban_appeals WHERE guild_id = ? AND user_key = ? ORDER BY id DESC LIMIT 1').get(guildId, keyOf(guildId, userId));
}

export function resolveBanAppeal(id, status, resolvedBy) {
  db.prepare('UPDATE ban_appeals SET status = ?, resolved_by = ?, resolved_at = ?, dm_id = NULL WHERE id = ?').run(status, resolvedBy, Date.now(), id);
}

/* ---------- refresh old posts ---------- */

/** Newest still-visible posts of a server (for /setup refreshposts). */
export function listRecentPosted(guildId, limit) {
  return db
    .prepare("SELECT * FROM confessions WHERE guild_id = ? AND status = 'posted' AND message_id IS NOT NULL AND channel_id IS NOT NULL ORDER BY id DESC LIMIT ?")
    .all(guildId, limit);
}

/* ---------- auto-filter rules ---------- */

export function addFilterRule(guildId, kind, pattern) {
  const r = db.prepare('INSERT INTO filter_rules (guild_id, kind, pattern, created_at) VALUES (?, ?, ?, ?)').run(guildId, kind, pattern, Date.now());
  return Number(r.lastInsertRowid);
}

export function listFilterRules(guildId) {
  return db.prepare('SELECT * FROM filter_rules WHERE guild_id = ? ORDER BY id').all(guildId);
}

export function removeFilterRule(guildId, id) {
  return db.prepare('DELETE FROM filter_rules WHERE guild_id = ? AND id = ?').run(guildId, id).changes > 0;
}

/* ---------- user preferences (global, not per server) ---------- */

export function getPrefs(userId) {
  return db.prepare('SELECT notify_off, preview FROM user_prefs WHERE user_id = ?').get(userId) ?? { notify_off: 0, preview: 0 };
}

/** `field` is 'notify_off' or 'preview'. */
export function setPref(userId, field, value) {
  if (field !== 'notify_off' && field !== 'preview') throw new Error(`Bad pref: ${field}`);
  db.prepare('INSERT OR IGNORE INTO user_prefs (user_id) VALUES (?)').run(userId);
  db.prepare(`UPDATE user_prefs SET ${field} = ? WHERE user_id = ?`).run(value ? 1 : 0, userId);
}

/* ---------- poll closing ---------- */

export function closePollRow(id) {
  return db.prepare('UPDATE confessions SET poll_closed_at = ? WHERE id = ? AND poll_closed_at IS NULL').run(Date.now(), id).changes > 0;
}

/** Open polls whose end time has passed. */
export function listDuePolls(now = Date.now()) {
  return db
    .prepare("SELECT * FROM confessions WHERE is_poll = 1 AND poll_closed_at IS NULL AND poll_ends_at IS NOT NULL AND poll_ends_at <= ? AND status = 'posted'")
    .all(now);
}

/* ---------- featured channel ---------- */

export function setFeatured(id, channelId, messageId) {
  db.prepare('UPDATE confessions SET featured_channel_id = ?, featured_message_id = ? WHERE id = ?').run(channelId, messageId, id);
}

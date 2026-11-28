// All database access. Postgres (Supabase): the schema lives in supabase/migrations, applied with `npm run db:migrate`.
import { readdirSync } from 'node:fs';
import { isKey, keyOf, secretFingerprint, userKey } from './lib/identity.js';
import { all, closePool, get, lock, run, snapshotTransaction, transaction } from './pg.js';

export { closePool };

/** Run `fn(query)` against one unchanging view of the database (for backups). */
export const readSnapshot = (fn) => snapshotTransaction(fn);

// Refuse to start on a database that is missing a migration, instead of failing later in the middle of a command.
{
  const expected = readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter((f) => f.endsWith('.sql'));
  const table = await get("SELECT to_regclass('public.schema_migrations') AS t");
  const applied = new Set(table.t ? (await all('SELECT name FROM schema_migrations')).map((r) => r.name) : []);
  const missing = expected.filter((f) => !applied.has(f));
  if (missing.length) throw new Error(`The database is not up to date. Run: npm run db:migrate (missing ${missing.join(', ')})`);
}

// Remember which secret made the stored keys. If it changes, every ban and warning silently stops matching: say so.
{
  const fp = secretFingerprint();
  await run("INSERT INTO meta (key, value) VALUES ('idkey_fp', ?) ON CONFLICT (key) DO NOTHING", fp);
  const { value } = await get("SELECT value FROM meta WHERE key = 'idkey_fp'");
  if (value !== fp) {
    console.error(
      'WARNING: the ID hash secret is different from the one this database was written with (ID_HASH_SECRET or DISCORD_TOKEN changed).\n' +
        'Existing bans, warnings and notes will NOT match their users any more. Restore the old secret.',
    );
  }
}

export async function getDmCursor(userId) {
  return (await get('SELECT last_id FROM dm_cursor WHERE user_id = ?', userId))?.last_id ?? null;
}

export async function setDmCursor(userId, lastId) {
  await run('INSERT INTO dm_cursor (user_id, last_id) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET last_id = excluded.last_id', userId, lastId);
}

/** Everyone the bot has talked to: past authors plus anyone with a cursor. */
export async function knownDmUsers() {
  const rows = await all("SELECT author_id AS id FROM confessions WHERE author_id != '' UNION SELECT user_id AS id FROM dm_cursor");
  return rows.map((r) => r.id);
}

/* ---------- guild config ---------- */

const GUILD_FIELDS = new Set([
  'channel_id', 'log_channel_id', 'role_id', 'mod_role_id', 'sticky_id', 'cooldown', 'warn_limit', 'welcome_dm',
  'online_role_id', 'online_notified_at', 'report_limit', 'warn_expiry_days', 'highlight_channel_id', 'highlight_period',
  'highlight_daily_at', 'highlight_weekly_at', 'self_delete_minutes', 'retention_days', 'approval_mode', 'filter_action',
  'block_invites', 'block_links', 'poll_hours', 'featured_channel_id', 'featured_threshold', 'min_join_days',
  'min_account_days', 'daily_cap', 'dup_hours', 'owner_pin', 'auto_thread', 'paused_until', 'pause_reason',
  'quiet_start', 'quiet_end', 'pause_hold', 'quiet_hold', 'image_days',
]);

export async function getGuild(guildId) {
  return await get('SELECT * FROM guilds WHERE guild_id = ?', guildId);
}

export async function updateGuild(guildId, fields) {
  const entries = Object.entries(fields);
  for (const [key] of entries) if (!GUILD_FIELDS.has(key)) throw new Error(`Bad guild field: ${key}`);
  await run('INSERT INTO guilds (guild_id) VALUES (?) ON CONFLICT (guild_id) DO NOTHING', guildId);
  if (entries.length) {
    // One statement, so the settings change together.
    const sets = entries.map(([key]) => `${key} = ?`).join(', ');
    await run(`UPDATE guilds SET ${sets} WHERE guild_id = ?`, ...entries.map(([, value]) => value ?? null), guildId);
  }
  return await getGuild(guildId);
}

export async function configuredGuilds() {
  return await all('SELECT * FROM guilds WHERE channel_id IS NOT NULL');
}

/* ---------- confessions ---------- */

/**
 * `extras` = { tag, pollOptions, pollHours, replyTo, cw, pending, scheduled, holdReason, threadRoot, opTag } (all optional).
 * `pending` posts wait for a moderator, `scheduled` ones for posting to resume: neither has a public number (see
 * assignNumber) or a poll end time yet.
 * Poll options are stored together with the confession.
 */
export async function createConfession(guildId, authorId, content, hasImage = false, extras = {}) {
  return await transaction(async () => {
    const waiting = extras.pending ? 'pending' : extras.scheduled ? 'scheduled' : null;
    // Locks the server's row until commit, so two posts cannot take the same number or Submission ID.
    const guild = await get('SELECT counter FROM guilds WHERE guild_id = ? FOR UPDATE', guildId);
    let counter = 0;
    if (!waiting) {
      if (!guild) throw new Error(`Server ${guildId} is not set up.`);
      ({ counter } = await get('UPDATE guilds SET counter = counter + 1 WHERE guild_id = ? RETURNING counter', guildId));
    }
    const { next: subId } = await get('SELECT COALESCE(MAX(sub_id), 0) + 1 AS next FROM confessions WHERE guild_id = ?', guildId);
    const isPoll = extras.pollOptions?.length ? 1 : 0;
    const pollHours = isPoll ? (extras.pollHours ?? 0) : 0;
    const now = Date.now();
    const { id } = await get(
      `INSERT INTO confessions (guild_id, number, author_id, author_key, content, has_image, created_at, tag, is_poll, sub_id,
                                status, reply_to, cw, poll_hours, poll_ends_at, hold_reason, thread_root, op_tag)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      guildId, counter, authorId, keyOf(guildId, authorId), content, hasImage ? 1 : 0, now, extras.tag ?? null, isPoll, subId,
      waiting ?? 'posted', extras.replyTo ?? null, extras.cw ?? null, pollHours,
      !waiting && pollHours > 0 ? now + pollHours * 3_600_000 : null, extras.holdReason ?? null,
      extras.threadRoot ?? null, extras.opTag ? 1 : 0,
    );
    for (const [idx, label] of (extras.pollOptions ?? []).entries()) {
      await run('INSERT INTO poll_options (confession_id, idx, label) VALUES (?, ?, ?)', id, idx, label);
    }
    return { id, number: counter, subId };
  });
}

/** A waiting post goes live: give it the next public number and start its poll clock. Returns the number. */
export async function assignNumber(guildId, id) {
  return await transaction(async () => {
    const { counter } = await get('UPDATE guilds SET counter = counter + 1 WHERE guild_id = ? RETURNING counter', guildId);
    const now = Date.now();
    await run(
      "UPDATE confessions SET number = ?, status = 'posted', posted_at = ?, poll_ends_at = CASE WHEN poll_hours > 0 THEN ?::bigint + poll_hours::bigint * 3600000 ELSE NULL END WHERE guild_id = ? AND id = ?",
      counter, now, now, guildId, id,
    );
    return counter;
  });
}

/** Posting a waiting submission failed: put it back (`status`) and give the number back. */
export async function revertAssign(guildId, id, number, status = 'pending') {
  return await transaction(async () => {
    await run('UPDATE guilds SET counter = counter - 1 WHERE guild_id = ? AND counter = ?', guildId, number);
    await run('UPDATE confessions SET number = 0, status = ?, posted_at = NULL, poll_ends_at = NULL WHERE guild_id = ? AND id = ?', status, guildId, id);
  });
}

/** Undo a createConfession whose Discord post failed. Call only while holding the guild lock. */
export async function discardConfession(guildId, id, number) {
  return await transaction(async () => {
    await run('DELETE FROM confession_images WHERE confession_id = ?', id);
    await run('DELETE FROM poll_options WHERE confession_id = ?', id);
    await run('DELETE FROM confessions WHERE guild_id = ? AND id = ?', guildId, id);
    await run('UPDATE guilds SET counter = counter - 1 WHERE guild_id = ? AND counter = ?', guildId, number);
  });
}

export async function setConfessionImage(id, name, buffer) {
  await run(
    'INSERT INTO confession_images (confession_id, name, data) VALUES (?, ?, ?) ON CONFLICT (confession_id) DO UPDATE SET name = excluded.name, data = excluded.data',
    id, name, buffer,
  );
}

/** { name, buffer } or null. */
export async function getConfessionImage(id) {
  const r = await get('SELECT name, data FROM confession_images WHERE confession_id = ?', id);
  return r ? { name: r.name, buffer: Buffer.from(r.data) } : null;
}

/** What the public post looked like (text with links, color), so an auto-hidden post can be put back. */
export async function setConfessionRendered(id, rendered, color) {
  await run('UPDATE confessions SET rendered = ?, color = ? WHERE id = ?', rendered, color, id);
}

export async function setConfessionMessage(guildId, id, channelId, messageId) {
  await run('UPDATE confessions SET channel_id = ?, message_id = ? WHERE guild_id = ? AND id = ?', channelId, messageId, guildId, id);
}

/** Look up by the internal key (used inside button ids). Scoped to the server. */
export async function getConfession(guildId, id) {
  return await get('SELECT * FROM confessions WHERE guild_id = ? AND id = ?', guildId, id);
}

/** Look up by the Submission ID moderators see and type (counts per server). */
export async function getConfessionBySubId(guildId, subId) {
  return await get('SELECT * FROM confessions WHERE guild_id = ? AND sub_id = ?', guildId, subId);
}

/** Newest still-posted confession with this public number (numbers repeat after a reset). */
export async function getLatestPostedByNumber(guildId, number) {
  return await get(`SELECT * FROM confessions
       WHERE guild_id = ? AND number = ? AND status = 'posted' AND message_id IS NOT NULL AND channel_id IS NOT NULL
       ORDER BY id DESC LIMIT 1`, guildId, number);
}

export async function getConfessionByMessage(guildId, messageId) {
  return await get('SELECT * FROM confessions WHERE guild_id = ? AND message_id = ?', guildId, messageId);
}

export async function markConfession(guildId, id, status) {
  await run('UPDATE confessions SET status = ? WHERE guild_id = ? AND id = ?', status, guildId, id);
}

/** Restart the public numbering. The next confession gets `startAt` (default 1). IDs are untouched. */
export async function resetCounter(guildId, startAt = 1) {
  await run(
    'INSERT INTO guilds (guild_id, counter) VALUES (?, ?) ON CONFLICT (guild_id) DO UPDATE SET counter = excluded.counter',
    guildId, startAt - 1,
  );
}

export async function lastConfessionAt(guildId, userId) {
  const row = await get('SELECT MAX(created_at) AS t FROM confessions WHERE guild_id = ? AND author_key = ?', guildId, keyOf(guildId, userId));
  return row?.t ?? 0;
}

/** Creation times (oldest first) of this person's posts since `since`; rejected posts do not count. For the daily cap. */
export async function postTimesSince(guildId, userId, since) {
  return (await all("SELECT created_at FROM confessions WHERE guild_id = ? AND author_key = ? AND created_at >= ? AND status != 'rejected' ORDER BY created_at ASC", guildId, keyOf(guildId, userId), since))
    .map((r) => r.created_at);
}

/** Text of the newest posts since `since` (any author, any status), for the repost blocker. Erased texts are skipped. */
export async function recentContents(guildId, since, limit = 300) {
  return await all("SELECT content FROM confessions WHERE guild_id = ? AND created_at >= ? AND content != '' ORDER BY id DESC LIMIT ?", guildId, since, limit);
}

export async function countPending(guildId) {
  return (await get("SELECT COUNT(*) AS n FROM confessions WHERE guild_id = ? AND status = 'pending'", guildId)).n;
}

/** False when the ID hash secret differs from the one the stored keys were made with. */
export async function secretMatches() {
  const stored = (await get("SELECT value FROM meta WHERE key = 'idkey_fp'"))?.value;
  return !stored || stored === secretFingerprint();
}

/* ---------- warnings & bans ---------- */

/** Returns the new warning's id (shown to the user as W-0042). */
export async function addWarning(guildId, userId, confessionId, reason) {
  const { id } = await get(
    'INSERT INTO warnings (guild_id, user_id, confession_id, reason, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id',
    guildId, keyOf(guildId, userId), confessionId, reason ?? null, Date.now(),
  );
  return id;
}

export async function getWarning(id) {
  return await get('SELECT * FROM warnings WHERE id = ?', id);
}

export async function deleteWarning(id) {
  return await run('DELETE FROM warnings WHERE id = ?', id) > 0;
}

/* ---------- appeals ---------- */

export async function addAppeal(warningId, guildId, userId, message) {
  await run('INSERT INTO appeals (warning_id, guild_id, user_id, message, created_at) VALUES (?, ?, ?, ?, ?)', warningId, guildId, userId, message ?? null, Date.now());
}

export async function getAppeal(warningId) {
  return await get('SELECT * FROM appeals WHERE warning_id = ?', warningId);
}

export async function resolveAppeal(warningId, status, resolvedBy) {
  await run('UPDATE appeals SET status = ?, resolved_by = ? WHERE warning_id = ?', status, resolvedBy, warningId);
}

const DAY_MS = 86_400_000;

/** Warnings older than the server's warn_expiry_days (0 = never) no longer count towards the limit. */
async function warningCutoff(guildId) {
  const days = (await getGuild(guildId))?.warn_expiry_days ?? 0;
  return days > 0 ? Date.now() - days * DAY_MS : 0;
}

/** Warnings that still count (not expired). */
export async function countWarnings(guildId, userId) {
  return (await get('SELECT COUNT(*) AS n FROM warnings WHERE guild_id = ? AND user_id = ? AND created_at > ?', guildId, keyOf(guildId, userId), await warningCutoff(guildId))).n;
}

/** Every warning ever given, newest first, with whether it has expired. */
export async function listWarnings(guildId, userId) {
  const cutoff = await warningCutoff(guildId);
  return (await all('SELECT * FROM warnings WHERE guild_id = ? AND user_id = ? ORDER BY id DESC', guildId, keyOf(guildId, userId)))
    .map((w) => ({ ...w, expired: w.created_at <= cutoff }));
}

export async function clearWarnings(guildId, userId) {
  await run('DELETE FROM warnings WHERE guild_id = ? AND user_id = ?', guildId, keyOf(guildId, userId));
}

/** `expiresAt` = epoch ms when the ban lifts itself, or null for a permanent ban. */
export async function banUser(guildId, userId, reason, bannedBy, expiresAt = null, dmId = null) {
  // dm_id (raw ID) is kept only for timed bans, so the bot can DM when one ends. The retention purge clears it.
  const raw = expiresAt ? (dmId || (isKey(userId) ? null : userId)) : null;
  await run(
    `INSERT INTO bans (guild_id, user_id, reason, banned_by, created_at, expires_at, dm_id) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (guild_id, user_id) DO UPDATE SET reason = excluded.reason, banned_by = excluded.banned_by,
       created_at = excluded.created_at, expires_at = excluded.expires_at, dm_id = excluded.dm_id`,
    guildId, keyOf(guildId, userId), reason ?? null, bannedBy ?? null, Date.now(), expiresAt, raw,
  );
}

/** Remove and return every ban whose time is up (the scheduler tells the user and the mods). */
export async function takeExpiredBans() {
  return await all('DELETE FROM bans WHERE expires_at IS NOT NULL AND expires_at <= ? RETURNING *', Date.now());
}

export async function unbanUser(guildId, userId) {
  return await run('DELETE FROM bans WHERE guild_id = ? AND user_id = ?', guildId, keyOf(guildId, userId)) > 0;
}

/** The active ban, or undefined. A timed ban whose time has passed counts as lifted even before the scheduler runs. */
export async function getBan(guildId, userId) {
  return await get('SELECT * FROM bans WHERE guild_id = ? AND user_id = ? AND (expires_at IS NULL OR expires_at > ?)', guildId, keyOf(guildId, userId), Date.now());
}

/* ---------- reports ---------- */

/** Reactions, votes and reports are stored under the person's key for that server, never the raw ID. */
async function voterKey(confessionId, userId) {
  const guildId = (await get('SELECT guild_id FROM confessions WHERE id = ?', confessionId))?.guild_id ?? '';
  return keyOf(guildId, userId);
}

/** True when this is a new report (each person can report a post once). */
export async function addReport(confessionId, reporterId, reason) {
  return (
    await run('INSERT INTO reports (confession_id, reporter_id, reason, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (confession_id, reporter_id) DO NOTHING', confessionId, await voterKey(confessionId, reporterId), reason ?? null, Date.now()) > 0
  );
}

export async function hasReported(confessionId, reporterId) {
  return Boolean(
    await get('SELECT 1 FROM reports WHERE confession_id = ? AND reporter_id = ?', confessionId, await voterKey(confessionId, reporterId)),
  );
}

export async function countReports(confessionId) {
  return (await get('SELECT COUNT(*) AS n FROM reports WHERE confession_id = ?', confessionId)).n;
}

export async function clearReports(confessionId) {
  await run('DELETE FROM reports WHERE confession_id = ?', confessionId);
}

/* ---------- mod notes & history ---------- */

export async function addNote(guildId, userId, confessionId, note, moderatorId) {
  await run('INSERT INTO mod_notes (guild_id, user_id, confession_id, note, moderator_id, created_at) VALUES (?, ?, ?, ?, ?, ?)', guildId, keyOf(guildId, userId), confessionId, note, moderatorId, Date.now());
}

export async function listNotes(guildId, userId) {
  return await all('SELECT * FROM mod_notes WHERE guild_id = ? AND user_id = ? ORDER BY id DESC', guildId, keyOf(guildId, userId));
}

export async function listConfessionsByAuthor(guildId, userId) {
  return await all('SELECT * FROM confessions WHERE guild_id = ? AND author_key = ? ORDER BY id DESC', guildId, keyOf(guildId, userId));
}

/* ---------- topic channels ---------- */

export async function getTagChannel(guildId, tag) {
  return (await get('SELECT channel_id FROM tag_channels WHERE guild_id = ? AND tag = ?', guildId, tag))?.channel_id ?? null;
}

export async function setTagChannel(guildId, tag, channelId) {
  if (!channelId) await run('DELETE FROM tag_channels WHERE guild_id = ? AND tag = ?', guildId, tag);
  else
    await run('INSERT INTO tag_channels (guild_id, tag, channel_id) VALUES (?, ?, ?) ON CONFLICT(guild_id, tag) DO UPDATE SET channel_id = excluded.channel_id', guildId, tag, channelId);
}

export async function listTagChannels(guildId) {
  return await all('SELECT tag, channel_id FROM tag_channels WHERE guild_id = ?', guildId);
}

/* ---------- reactions & polls (votes are never shown with a name, the user id only enforces one vote each) ---------- */

/** Click a reaction: same one again removes it, a different one switches. Returns the user's new reaction or null. */
export async function toggleReaction(confessionId, userId, kind) {
  const voter = await voterKey(confessionId, userId);
  return await transaction(async () => {
    await lock(`reaction:${confessionId}:${voter}`); // two quick taps are handled one after the other
    const current = (await get('SELECT kind FROM reactions WHERE confession_id = ? AND user_id = ?', confessionId, voter))?.kind;
    if (current === kind) {
      await run('DELETE FROM reactions WHERE confession_id = ? AND user_id = ?', confessionId, voter);
      return null;
    }
    await run(
      'INSERT INTO reactions (confession_id, user_id, kind) VALUES (?, ?, ?) ON CONFLICT(confession_id, user_id) DO UPDATE SET kind = excluded.kind',
      confessionId, voter, kind,
    );
    return kind;
  });
}

export async function reactionCounts(confessionId) {
  const counts = { up: 0, down: 0 };
  for (const r of await all('SELECT kind, COUNT(*) AS n FROM reactions WHERE confession_id = ? GROUP BY kind', confessionId)) {
    counts[r.kind] = r.n;
  }
  return counts;
}

export async function getPollOptions(confessionId) {
  return await all('SELECT idx, label FROM poll_options WHERE confession_id = ? ORDER BY idx', confessionId);
}

/** Vote for option `idx`; the same option again withdraws the vote. Returns the new choice or null. */
export async function togglePollVote(confessionId, userId, idx) {
  const voter = await voterKey(confessionId, userId);
  return await transaction(async () => {
    await lock(`vote:${confessionId}:${voter}`);
    // Holds the post's row until commit: a poll cannot close between this check and the vote.
    const post = await get('SELECT poll_closed_at FROM confessions WHERE id = ? FOR SHARE', confessionId);
    if (post?.poll_closed_at) return undefined;
    const current = (await get('SELECT idx FROM poll_votes WHERE confession_id = ? AND user_id = ?', confessionId, voter))?.idx;
    if (current === idx) {
      await run('DELETE FROM poll_votes WHERE confession_id = ? AND user_id = ?', confessionId, voter);
      return null;
    }
    await run(
      'INSERT INTO poll_votes (confession_id, user_id, idx) VALUES (?, ?, ?) ON CONFLICT(confession_id, user_id) DO UPDATE SET idx = excluded.idx',
      confessionId, voter, idx,
    );
    return idx;
  });
}

/** Map of option idx -> votes. */
export async function pollCounts(confessionId) {
  const counts = new Map();
  for (const r of await all('SELECT idx, COUNT(*) AS n FROM poll_votes WHERE confession_id = ? GROUP BY idx', confessionId)) {
    counts.set(r.idx, r.n);
  }
  return counts;
}

/* ---------- highlights ---------- */

/** Most-liked post (👍, fewest 👎 breaks ties, then the older one) created at or after `since`. Null when nobody liked anything. */
export async function topLikedSince(guildId, since) {
  return (
    (await get(
      `SELECT c.*,
              COUNT(*) FILTER (WHERE r.kind = 'up')   AS ups,
              COUNT(*) FILTER (WHERE r.kind = 'down') AS downs
         FROM confessions c LEFT JOIN reactions r ON r.confession_id = c.id
        WHERE c.guild_id = ? AND c.status = 'posted' AND COALESCE(c.posted_at, c.created_at) >= ? AND c.message_id IS NOT NULL AND c.purged_at IS NULL
          AND c.thread_root IS NULL
        GROUP BY c.id
       HAVING COUNT(*) FILTER (WHERE r.kind = 'up') > 0
        ORDER BY ups DESC, downs ASC, c.id ASC
        LIMIT 1`,
      guildId, since,
    )) ?? null
  );
}

export async function guildsWithHighlights() {
  return await all("SELECT * FROM guilds WHERE highlight_channel_id IS NOT NULL AND highlight_period != 'off'");
}

/* ---------- retention ---------- */

/**
 * For every server with a retention period: wipe the sender ID, text and image of posts older than that, and the raw
 * ID kept for timed-ban DMs. The row stays (IDs, numbers, status, key) so history, bans and warnings keep working.
 * Returns how many posts were purged.
 */
export async function purgeExpired() {
  const now = Date.now();
  let purged = 0;
  for (const g of await all('SELECT guild_id, retention_days FROM guilds WHERE retention_days > 0')) {
    const cutoff = now - g.retention_days * DAY_MS;
    purged += await transaction(async () => {
      await run(
        'DELETE FROM confession_images WHERE confession_id IN (SELECT id FROM confessions WHERE guild_id = ? AND created_at < ? AND purged_at IS NULL)',
        g.guild_id, cutoff,
      );
      const changed = await run(
        "UPDATE confessions SET author_id = '', content = '', rendered = NULL, purged_at = ? WHERE guild_id = ? AND created_at < ? AND purged_at IS NULL",
        now, g.guild_id, cutoff,
      );
      await run('UPDATE bans SET dm_id = NULL WHERE guild_id = ? AND created_at < ? AND dm_id IS NOT NULL', g.guild_id, cutoff);
      await run("UPDATE ban_appeals SET dm_id = NULL, message = NULL WHERE guild_id = ? AND created_at < ? AND status != 'open'", g.guild_id, cutoff);
      return changed;
    });
  }
  return purged;
}

/**
 * Space saver, separate from retention: for every server with an image period, delete stored images of finished posts
 * older than that. Sender IDs, text and all other records stay. Posts still waiting (approval, saved, hidden) keep
 * theirs, because the picture is needed to put them up. Returns how many images were deleted.
 */
export async function purgeOldImages() {
  return await run(
    `DELETE FROM confession_images i USING confessions c, guilds g
      WHERE c.id = i.confession_id AND g.guild_id = c.guild_id AND g.image_days > 0
        AND c.created_at < ?::bigint - g.image_days::bigint * ?::bigint
        AND c.status IN ('posted', 'deleted', 'rejected')`,
    Date.now(), DAY_MS,
  );
}

/* ---------- ban appeals (DM: fw appeal <text>) ---------- */

export async function addBanAppeal(guildId, userId, message) {
  const { id } = await get(
    'INSERT INTO ban_appeals (guild_id, user_key, dm_id, message, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id',
    guildId, keyOf(guildId, userId), userId, message, Date.now(),
  );
  return id;
}

export async function getBanAppeal(id) {
  return await get('SELECT * FROM ban_appeals WHERE id = ?', id);
}

/** The user's newest appeal in this server, or undefined. */
export async function latestBanAppeal(guildId, userId) {
  return await get('SELECT * FROM ban_appeals WHERE guild_id = ? AND user_key = ? ORDER BY id DESC LIMIT 1', guildId, keyOf(guildId, userId));
}

export async function resolveBanAppeal(id, status, resolvedBy) {
  await run('UPDATE ban_appeals SET status = ?, resolved_by = ?, resolved_at = ?, dm_id = NULL WHERE id = ?', status, resolvedBy, Date.now(), id);
}

/* ---------- refresh old posts ---------- */

/** Newest still-visible posts of a server (for /setup refreshposts). */
export async function listRecentPosted(guildId, limit) {
  return await all("SELECT * FROM confessions WHERE guild_id = ? AND status = 'posted' AND message_id IS NOT NULL AND channel_id IS NOT NULL ORDER BY id DESC LIMIT ?", guildId, limit);
}

/* ---------- auto-filter rules ---------- */

export async function addFilterRule(guildId, kind, pattern) {
  const { id } = await get(
    'INSERT INTO filter_rules (guild_id, kind, pattern, created_at) VALUES (?, ?, ?, ?) RETURNING id',
    guildId, kind, pattern, Date.now(),
  );
  return id;
}

export async function listFilterRules(guildId) {
  return await all('SELECT * FROM filter_rules WHERE guild_id = ? ORDER BY id', guildId);
}

export async function removeFilterRule(guildId, id) {
  return await run('DELETE FROM filter_rules WHERE guild_id = ? AND id = ?', guildId, id) > 0;
}

/* ---------- user preferences (global, not per server) ---------- */

export async function getPrefs(userId) {
  return await get('SELECT notify_off, preview FROM user_prefs WHERE user_id = ?', userId) ?? { notify_off: 0, preview: 0 };
}

/** `field` is 'notify_off' or 'preview'. */
export async function setPref(userId, field, value) {
  if (field !== 'notify_off' && field !== 'preview') throw new Error(`Bad pref: ${field}`);
  await run(
    `INSERT INTO user_prefs (user_id, ${field}) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET ${field} = excluded.${field}`,
    userId, value ? 1 : 0,
  );
}

/* ---------- poll closing ---------- */

export async function closePollRow(id) {
  return await run('UPDATE confessions SET poll_closed_at = ? WHERE id = ? AND poll_closed_at IS NULL', Date.now(), id) > 0;
}

/** Open polls whose end time has passed. */
export async function listDuePolls(now = Date.now()) {
  return await all("SELECT * FROM confessions WHERE is_poll = 1 AND poll_closed_at IS NULL AND poll_ends_at IS NOT NULL AND poll_ends_at <= ? AND status = 'posted'", now);
}

/* ---------- featured channel ---------- */

export async function setFeatured(id, channelId, messageId) {
  await run('UPDATE confessions SET featured_channel_id = ?, featured_message_id = ? WHERE id = ?', channelId, messageId, id);
}

/* ---------- reply threads ---------- */

export async function setThread(id, threadId) {
  await run('UPDATE confessions SET thread_id = ? WHERE id = ?', threadId, id);
}

export async function setAlias(id, alias) {
  await run('UPDATE confessions SET alias = ? WHERE id = ?', alias, id);
}

/** This person's number in the thread under post `rootId` (1, 2, 3... in order of first reply). `userKey` is their key. */
export async function threadAlias(rootId, userKey) {
  return await transaction(async () => {
    await lock(`alias:${rootId}`); // two first replies must not get the same number
    const found = await get('SELECT alias FROM thread_aliases WHERE root_id = ? AND user_key = ?', rootId, userKey);
    if (found) return found.alias;
    const { next } = await get('SELECT COALESCE(MAX(alias), 0) + 1 AS next FROM thread_aliases WHERE root_id = ?', rootId);
    await run('INSERT INTO thread_aliases (root_id, user_key, alias) VALUES (?, ?, ?)', rootId, userKey, next);
    return next;
  });
}

/* ---------- moderator views: queue, search, stats ---------- */

async function page(where, args, order, limit, offset) {
  const { n } = await get(`SELECT COUNT(*) AS n FROM confessions WHERE ${where}`, ...args);
  const rows = await all(`SELECT * FROM confessions WHERE ${where} ORDER BY id ${order} LIMIT ? OFFSET ?`, ...args, limit, offset);
  return { rows, total: n };
}

/** Posts waiting for approval, hidden after reports, or saved until posting resumes. Oldest first. */
export async function listQueue(guildId, limit, offset = 0) {
  return await page("guild_id = ? AND status IN ('pending', 'hidden', 'scheduled')", [guildId], 'ASC', limit, offset);
}

/** `filters` = { text, tag, status, since }, all optional. Newest first. Never filters by author. */
export async function searchConfessions(guildId, { text, tag, status, since } = {}, limit = 10, offset = 0) {
  const where = ['guild_id = ?'];
  const args = [guildId];
  if (text) {
    where.push("(content ILIKE ? ESCAPE '\\' OR cw ILIKE ? ESCAPE '\\')"); // ILIKE: any letter case
    const like = `%${text.replace(/[\\%_]/g, '\\$&')}%`;
    args.push(like, like);
  }
  if (tag) {
    where.push('tag = ?');
    args.push(tag);
  }
  if (status) {
    where.push('status = ?');
    args.push(status);
  }
  if (since) {
    where.push('created_at >= ?');
    args.push(since);
  }
  return await page(where.join(' AND '), args, 'DESC', limit, offset);
}

/** Server-wide totals for posts created since `since`, plus what is waiting right now. */
export async function guildStats(guildId, since) {
  const recent = 'FROM confessions WHERE guild_id = ? AND created_at >= ?';
  const totals = await get(
    `SELECT COUNT(*) FILTER (WHERE reply_to IS NOT NULL) AS replies, COALESCE(SUM(is_poll), 0) AS polls, COALESCE(SUM(has_image), 0) AS images ${recent}`,
    guildId, since,
  );
  const waiting = await get(
    "SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM confessions WHERE guild_id = ? AND status IN ('pending', 'hidden', 'scheduled')",
    guildId,
  );
  const byStatus = await all(`SELECT status, COUNT(*) AS n ${recent} GROUP BY status`, guildId, since);
  return {
    ...totals,
    byStatus: new Map(byStatus.map((r) => [r.status, r.n])),
    topics: await all(`SELECT tag, COUNT(*) AS n ${recent} GROUP BY tag ORDER BY n DESC, tag COLLATE "C" NULLS FIRST LIMIT 5`, guildId, since),
    reports: (await get(
      'SELECT COUNT(*) AS n FROM reports r JOIN confessions c ON c.id = r.confession_id WHERE c.guild_id = ? AND r.created_at >= ?',
      guildId, since,
    )).n,
    warnings: (await get('SELECT COUNT(*) AS n FROM warnings WHERE guild_id = ? AND created_at >= ?', guildId, since)).n,
    activeBans: (await get('SELECT COUNT(*) AS n FROM bans WHERE guild_id = ? AND (expires_at IS NULL OR expires_at > ?)', guildId, Date.now())).n,
    waiting: waiting.n,
    oldestWaiting: waiting.oldest,
  };
}

/* ---------- submissions saved while posting is on hold ---------- */

/** This person's submissions that are not up yet (saved for later, or waiting for approval). */
export async function countWaiting(guildId, userId) {
  return (await get("SELECT COUNT(*) AS n FROM confessions WHERE guild_id = ? AND author_key = ? AND status IN ('pending', 'scheduled')", guildId, keyOf(guildId, userId))).n;
}

export async function countScheduled(guildId) {
  return (await get("SELECT COUNT(*) AS n FROM confessions WHERE guild_id = ? AND status = 'scheduled'", guildId)).n;
}

/** Saved submissions in the order they were sent. */
export async function listScheduled(guildId) {
  return await all("SELECT * FROM confessions WHERE guild_id = ? AND status = 'scheduled' ORDER BY id", guildId);
}

export async function guildsWithScheduled() {
  return (await all("SELECT DISTINCT guild_id FROM confessions WHERE status = 'scheduled'")).map((r) => r.guild_id);
}

/** Count a refused attempt to post a saved submission. Returns how many there have been. */
export async function addReleaseTry(id) {
  return (await get('UPDATE confessions SET release_tries = release_tries + 1 WHERE id = ? RETURNING release_tries AS n', id)).n;
}

// Anti-abuse gates checked before a submission is accepted:
//   - join-age / account-age minimums      (/setup options min_join_days, min_account_days)
//   - daily post cap per person            (/setup options daily_cap)
//   - duplicate / repost blocker           (/setup options dup_hours)
// Each returns an error message for the author, or null when the post may go on.
import * as db from '../db.js';

const DAY = 86_400_000;
const MIN_DUP_LEN = 12; // shorter texts ("lol", "same") are allowed to repeat
const DUP_SIMILARITY = 0.9;
const DUP_CANDIDATES = 300;

const when = (ms) => `<t:${Math.ceil(ms / 1000)}:R>`;
const days = (n) => `${n} day${n === 1 ? '' : 's'}`;

/** Minimum time in the server / minimum Discord account age. `member` is a GuildMember. */
export function checkEligibility(member, cfg) {
  const now = Date.now();
  if (cfg.min_join_days > 0 && member.joinedTimestamp) {
    const at = member.joinedTimestamp + cfg.min_join_days * DAY;
    if (at > now) return `You can only post after being in this server for ${days(cfg.min_join_days)}. You can post ${when(at)}.`;
  }
  const created = member.user?.createdTimestamp;
  if (cfg.min_account_days > 0 && created) {
    const at = created + cfg.min_account_days * DAY;
    if (at > now) return `Your Discord account must be at least ${days(cfg.min_account_days)} old to post here. You can post ${when(at)}.`;
  }
  return null;
}

/** At most `daily_cap` posts per rolling 24 hours (rejected posts do not count). */
export async function checkDailyCap(guildId, userId, cfg) {
  if (!(cfg.daily_cap > 0)) return null;
  const times = await db.postTimesSince(guildId, userId, Date.now() - DAY); // oldest first
  if (times.length < cfg.daily_cap) return null;
  // The slot that frees up first is the one `cap` places from the newest.
  const frees = times[times.length - cfg.daily_cap] + DAY;
  return `You reached the limit of ${cfg.daily_cap} post${cfg.daily_cap === 1 ? '' : 's'} per 24 hours. You can post again ${when(frees)}.`;
}

/** Lowercase, no accents, no punctuation or extra spaces: "Hello,   WORLD!!" and "hello world" compare equal. */
export function normalize(text) {
  return (text ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function bigrams(s) {
  const map = new Map();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    map.set(g, (map.get(g) ?? 0) + 1);
  }
  return map;
}

/** Sorensen-Dice similarity of two normalized strings, 0..1. */
export function similarity(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const A = bigrams(a);
  const B = bigrams(b);
  let shared = 0;
  for (const [g, n] of A) shared += Math.min(n, B.get(g) ?? 0);
  return (2 * shared) / (a.length - 1 + (b.length - 1));
}

/** True when anyone in this server already posted (about) the same text within `hours`. */
export async function isDuplicate(guildId, content, hours) {
  if (!(hours > 0)) return false;
  const text = normalize(content);
  if (text.length < MIN_DUP_LEN) return false;
  for (const row of await db.recentContents(guildId, Date.now() - hours * 3_600_000, DUP_CANDIDATES)) {
    const other = normalize(row.content);
    if (other.length < MIN_DUP_LEN) continue;
    if (other === text) return true;
    const ratio = Math.min(text.length, other.length) / Math.max(text.length, other.length);
    if (ratio >= 0.85 && similarity(text, other) >= DUP_SIMILARITY) return true;
  }
  return false;
}

export const DUPLICATE_MESSAGE = 'That looks the same as a recent post, so it was not sent. Write something new.';

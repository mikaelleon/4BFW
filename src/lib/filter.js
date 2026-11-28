// Auto-filter: blocked words / regex, Discord invite links and any links. What happens on a hit (reject or hold for
// a moderator) is the server's `filter_action`; see /filter.
import * as db from '../db.js';

const INVITE = /(?:discord(?:app)?\.com\/invite|discord\.gg|dsc\.gg|invite\.gg)\/[a-z0-9-]+/i;
const LINK =
  /(?:https?:\/\/|www\.)[^\s<>]+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|gg|app|dev|link|info|biz|tv|xyz|ph|ly|ru|cn)(?:\/\S*)?(?=$|[\s<>.,!?)])/i;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Lowercase, accents and zero-width characters removed, so accent tricks and invisible padding do not dodge a rule. */
const normalize = (s) => s.normalize('NFKD').replace(/[̀-ͯ​-‏⁠﻿]/g, '').toLowerCase();

export const MAX_PATTERN_LEN = 100;

/** Error text for a regex an admin typed, or null when it is fine. Rejects ones that can freeze the bot. */
export function regexProblem(pattern) {
  if (pattern.length > MAX_PATTERN_LEN) return `Keep the pattern under ${MAX_PATTERN_LEN} characters.`;
  if (/(\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\))[+*{]/.test(pattern)) {
    return 'That pattern repeats a repeat (like `(a+)+`), which can freeze the bot. Simplify it.';
  }
  try {
    new RegExp(pattern, 'iu');
  } catch (err) {
    return `That is not a valid regex: ${err.message}`;
  }
  return null;
}

const cache = new Map(); // "<id>:<kind>:<pattern>" -> RegExp | null
function compile(rule) {
  const key = `${rule.id}:${rule.kind}:${rule.pattern}`;
  if (cache.has(key)) return cache.get(key);
  let re = null;
  try {
    re =
      rule.kind === 'regex'
        ? new RegExp(rule.pattern, 'iu')
        : new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(rule.pattern)}(?![\\p{L}\\p{N}])`, 'iu'); // whole word / phrase
  } catch {
    re = null;
  }
  cache.set(key, re);
  return re;
}

const short = (s) => (s.length > 40 ? `${s.slice(0, 39)}…` : s);

/**
 * Check the text of a post (content, content warning, poll options). Returns null, or
 * { kind, detail, userMessage }: `detail` is for moderators (names the rule), `userMessage` is for the author
 * and stays vague on purpose so nobody can probe the list.
 */
export async function checkFilters(guildId, texts, options = {}) {
  const hay = texts.filter(Boolean).join('\n');
  if (!hay) return null;
  const rules = options.rules ?? (await db.listFilterRules(guildId));
  const cfg = options.cfg ?? (await db.getGuild(guildId));
  const norm = normalize(hay);
  if (cfg?.block_invites && INVITE.test(norm)) {
    return { kind: 'invite', detail: 'Discord invite link', userMessage: 'Invite links are not allowed here. Remove it and try again.' };
  }
  if (cfg?.block_links && LINK.test(norm)) {
    return { kind: 'link', detail: 'Link', userMessage: 'Links are not allowed here. Remove it and try again.' };
  }
  for (const rule of rules) {
    const re = compile(rule);
    if (re && (re.test(hay) || re.test(norm))) {
      return {
        kind: rule.kind,
        detail: `${rule.kind === 'regex' ? 'Regex' : 'Word'} rule #${rule.id}: \`${short(rule.pattern)}\``,
        userMessage: 'Your post has a word or phrase that is not allowed here. Reword it and try again.',
      };
    }
  }
  return null;
}

// Ban lengths like "30m", "12h", "7d", "2w".

const UNITS = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };
export const MAX_DURATION_MS = 365 * UNITS.d;

/**
 * "7d" -> { ms: 604800000 }. Empty -> { ms: null } (permanent). Anything else -> { error }.
 */
export function parseDuration(text) {
  const t = (text ?? '').trim().toLowerCase();
  if (!t) return { ms: null };
  const m = t.match(/^(\d{1,4})\s*([mhdw])$/);
  if (!m) return { error: 'Duration looks like `30m`, `12h`, `7d` or `2w`. Leave it empty for a permanent ban.' };
  const ms = Number(m[1]) * UNITS[m[2]];
  if (ms <= 0) return { error: 'Duration must be more than zero.' };
  if (ms > MAX_DURATION_MS) return { error: 'Timed bans can last at most 365 days. Leave the duration empty for a permanent ban.' };
  return { ms };
}

/** Discord timestamp tag for "in 7 days" / "on <date>". */
export const untilTag = (expiresAt) => `<t:${Math.floor(expiresAt / 1000)}:R>`;

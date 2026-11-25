// Shared look & feel for 4BFW embeds.

export const COLOR = 0x242429;

export const prefix = () => process.env.BOT_PREFIX || 'fw';

/** 7 -> "007" (grows naturally past 999) */
export const fmtNum = (n) => String(n).padStart(3, '0');

/** Embed title: "Anonymous #007" */
export const anonTitle = (n) => `Anonymous #${fmtNum(n)}`;

/*
 * Submission post colors.
 *   - Untagged: a random gray, from near-black to near-white.
 *   - Tagged: the topic's own color, in a random shade (same hue family, different lightness / saturation).
 * Either way the next pick in the same server (and topic) is clearly different from the last one.
 */
const lastGray = new Map();
const lastShade = new Map();

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const between = (lo, hi) => lo + Math.random() * (hi - lo);
const byte = (x) => Math.round(clamp(x, 0, 1) * 255);

function hslToInt(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const channel = (n) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return (byte(channel(0)) << 16) | (byte(channel(8)) << 8) | byte(channel(4));
}

function intToHsl(color) {
  const r = ((color >> 16) & 255) / 255;
  const g = ((color >> 8) & 255) / 255;
  const b = (color & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

/** Random gray for an untagged post: black-ish to white-ish, at least 0.2 of the range away from the previous one. */
export function randomSubmissionColor(key = '') {
  const prev = lastGray.get(key);
  let value;
  do value = between(0.06, 0.96);
  while (prev !== undefined && Math.abs(value - prev) < 0.2);
  lastGray.set(key, value);
  const v = byte(value);
  return (v << 16) | (v << 8) | v;
}

/** A shade of a topic's color: hue within 8 degrees, lightness 38-76%, saturation within 10 points of the base. */
export function topicShade(base, key = '') {
  const { h, s } = intToHsl(base);
  const prev = lastShade.get(key);
  let light;
  do light = between(0.38, 0.76);
  while (prev !== undefined && Math.abs(light - prev) < 0.12);
  lastShade.set(key, light);
  return hslToInt((h + between(-8, 8) + 360) % 360, clamp(s + between(-0.1, 0.1), 0.2, 0.95), light);
}

/** Inline reference: "#007" */
export const anonRef = (n) => `#${fmtNum(n)}`;

/** Date + time like "9/15/2023 6:02 PM" in the server's timezone (set TIMEZONE in .env). */
export function formatDateTime(date = new Date()) {
  const timeZone = process.env.TIMEZONE || 'Asia/Manila';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
      .format(date)
      .replace(',', '');
  } catch {
    return date.toISOString(); // invalid TIMEZONE value
  }
}

/** Footer text + date and time, used by submission posts. */
export const footerLine = () =>
  `Type "/fw" or DM me "${prefix()} <message>" to send a submission • ${formatDateTime()}`;

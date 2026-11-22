// Shared look & feel for 4BFW embeds.

export const COLOR = 0x242429;

export const prefix = () => process.env.BOT_PREFIX || 'fw';

/** 7 -> "007" (grows naturally past 999) */
export const fmtNum = (n) => String(n).padStart(3, '0');

/** Embed title: "Anonymous #007" */
export const anonTitle = (n) => `Anonymous #${fmtNum(n)}`;

/* Submission posts (and only those) get a random color so neighbours are easy to tell apart. */
const lastHue = new Map();

function hslToInt(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const channel = (n) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  const byte = (x) => Math.round(x * 255);
  return (byte(channel(0)) << 16) | (byte(channel(8)) << 8) | byte(channel(4));
}

/** Random, readable-on-dark color. Each pick is at least 60 degrees of hue away from the previous one in that server. */
export function randomSubmissionColor(key = '') {
  const prev = lastHue.get(key);
  const hue = prev === undefined ? Math.random() * 360 : (prev + 60 + Math.random() * 240) % 360;
  lastHue.set(key, hue);
  return hslToInt(hue, 0.65, 0.62);
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

// Uptime shown on the home page. Once a minute, while connected to Discord, the bot counts that minute for the day
// (in TIMEZONE). The counts live in the `meta` table, so they survive restarts. A minute with no count is downtime.
import { Status } from 'discord.js';
import * as db from '../db.js';

const KEY = 'uptime';
const DAYS = 30;
const CHECK_MS = 20_000; // more than once a minute, so timer drift never skips a minute
const ZONE = process.env.TIMEZONE || 'Asia/Manila';

const parts = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** -> { day: "2026-11-29", minute: minutes since midnight } in TIMEZONE. */
function localTime(ms) {
  const p = Object.fromEntries(parts.formatToParts(ms).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, minute: Number(p.hour) * 60 + Number(p.minute) };
}

/** The day `n` days before "YYYY-MM-DD". */
const daysBefore = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

/** `data` with the minute of `now` counted, once, and days older than the window dropped. */
export function countMinute(data, now) {
  const bucket = Math.floor(now / 60_000);
  if (data && bucket <= data.last) return data;
  const { day } = localTime(now);
  const oldest = daysBefore(day, DAYS - 1);
  const days = Object.fromEntries(Object.entries(data?.days ?? {}).filter(([d]) => d >= oldest));
  days[day] = (days[day] ?? 0) + 1;
  return { since: data?.since ?? now, last: bucket, days };
}

/**
 * -> { days: [{ date, percent }] oldest first, percent } where a percent is null for time before tracking began.
 * A day's percent is the minutes counted out of the minutes that day has had since tracking began.
 */
export function summarise(data, now) {
  const today = localTime(now);
  const first = data ? localTime(data.since) : null;
  let up = 0;
  let total = 0;
  const days = Array.from({ length: DAYS }, (_, i) => {
    const date = daysBefore(today.day, DAYS - 1 - i);
    if (!first || date < first.day) return { date, percent: null };
    const from = date === first.day ? first.minute : 0;
    const to = date === today.day ? today.minute + 1 : 1440;
    const expected = Math.max(1, to - from);
    const counted = Math.min(expected, data.days[date] ?? 0);
    up += counted;
    total += expected;
    return { date, percent: (counted / expected) * 100 };
  });
  return { days, percent: total ? (up / total) * 100 : null };
}

let data = null;
let loaded = false;

const connected = (client) => client.isReady() && client.ws.shards.every((s) => s.status === Status.Ready);

async function beat(client) {
  if (!loaded) {
    const stored = await db.getMeta(KEY);
    data = stored ? JSON.parse(stored) : null;
    loaded = true;
  }
  if (!connected(client)) return;
  const next = countMinute(data, Date.now());
  if (next === data) return;
  data = next;
  await db.setMeta(KEY, JSON.stringify(data));
}

export function startUptime(client) {
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    beat(client)
      .catch((err) => console.error('Uptime count failed:', err.message))
      .finally(() => (running = false));
  };
  tick();
  setInterval(tick, CHECK_MS).unref();
}

/** What the home page shows. Read from memory, so page visits never touch the database. */
export function uptimeStatus(client) {
  return {
    online: connected(client),
    startedAt: client.readyTimestamp ?? null,
    ...summarise(data, Date.now()),
  };
}

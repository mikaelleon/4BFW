// When posting stops: a moderator pause (/mod pause) or the daily quiet hours (/setup quiethours). Each is either
// "closed" (nothing is accepted) or "hold" (submissions are accepted, saved, and posted once posting resumes).
// Quiet hours are clock times in the bot's TIMEZONE and may run past midnight (23:00 to 05:00).
const MINUTE = 60_000;
const DAY_MINUTES = 24 * 60;

const timeZone = () => process.env.TIMEZONE || 'Asia/Manila';

/** "23:05" / "5:00" -> minutes after midnight, or null when it is not a time. */
export function parseClock(text) {
  const m = /^\s*([01]?\d|2[0-3]):([0-5]\d)\s*$/.exec(text ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export const clockText = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** Minutes after midnight right now in TIMEZONE (UTC when the setting is invalid). */
function minuteOfDay(now) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timeZone(), hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
    const get = (type) => Number(parts.find((p) => p.type === type).value);
    return get('hour') * 60 + get('minute');
  } catch {
    const d = new Date(now);
    return d.getUTCHours() * 60 + d.getUTCMinutes();
  }
}

export const hasQuietHours = (cfg) => cfg?.quiet_start != null && cfg?.quiet_end != null && cfg.quiet_start !== cfg.quiet_end;

/** When the current quiet period ends (epoch ms), or null when it is not quiet hours. */
export function quietUntil(cfg, now = Date.now()) {
  if (!hasQuietHours(cfg)) return null;
  const { quiet_start: start, quiet_end: end } = cfg;
  const minute = minuteOfDay(now);
  const quiet = start < end ? minute >= start && minute < end : minute >= start || minute < end;
  if (!quiet) return null;
  return now - (now % MINUTE) + ((end - minute + DAY_MINUTES) % DAY_MINUTES) * MINUTE;
}

/** `paused_until`: null = not paused, 0 = until /mod resume, otherwise the time it lifts itself. */
export const isPaused = (cfg, now = Date.now()) => cfg?.paused_until != null && (cfg.paused_until === 0 || cfg.paused_until > now);

const stamp = (ms) => `<t:${Math.ceil(ms / 1000)}:R>`;
const when = (ms) => `<t:${Math.ceil(ms / 1000)}:f> (${stamp(ms)})`;

/** When posting can happen again if nothing is changed (epoch ms), or null when only /mod resume can tell. */
export function postingResumesAt(cfg, now = Date.now()) {
  let at = now;
  // A pause can end inside quiet hours (and the other way round), so follow them until both are over.
  for (let i = 0; i < 5; i++) {
    if (isPaused(cfg, at)) {
      if (cfg.paused_until === 0) return null;
      at = cfg.paused_until;
      continue;
    }
    const quiet = quietUntil(cfg, at);
    if (!quiet) break;
    at = quiet;
  }
  return at;
}

/**
 * 'open', 'hold' (accept now, post later) or 'closed' (accept nothing). When a pause and quiet hours overlap,
 * closed wins over hold.
 */
export function postingMode(cfg, now = Date.now()) {
  const paused = isPaused(cfg, now);
  const quiet = quietUntil(cfg, now) !== null;
  if ((paused && !cfg.pause_hold) || (quiet && !cfg.quiet_hold)) return 'closed';
  return paused || quiet ? 'hold' : 'open';
}

/** What to tell someone who tries to submit while nothing is accepted, or null when submissions are accepted. */
export function closedNotice(cfg, now = Date.now()) {
  if (isPaused(cfg, now) && !cfg.pause_hold) {
    const reason = cfg.pause_reason ? `\nReason: ${cfg.pause_reason}` : '';
    const back = cfg.paused_until ? ` They reopen ${stamp(cfg.paused_until)}.` : '';
    return `Submissions are paused right now.${back}${reason}`;
  }
  const until = quietUntil(cfg, now);
  return until && !cfg.quiet_hold ? `It is quiet hours, so submissions are closed. They reopen ${stamp(until)}.` : null;
}

/** The question put to an author before a submission is saved for later. */
export function holdPrompt(cfg, now = Date.now()) {
  const paused = isPaused(cfg, now);
  const why = paused ? 'Posting is paused right now.' : 'It is quiet hours, so nothing is being posted right now.';
  const reason = paused && cfg.pause_reason ? `\nReason: ${cfg.pause_reason}` : '';
  const at = postingResumesAt(cfg, now);
  const expected = at
    ? `Your submission is expected to be posted ${when(at)}. The time can change if moderators pause or resume.`
    : 'Your submission would be posted when moderators resume posting. There is no set time yet.';
  return `**${why}**${reason}\n${expected}\n\nPress **Post later** to save it until then, or **Cancel** to throw it away.`;
}

/** One line for moderators: the state of submissions right now. */
export function postingStatus(cfg, now = Date.now()) {
  const mode = postingMode(cfg, now);
  if (mode === 'open') return 'Open';
  if (mode === 'closed') return closedNotice(cfg, now);
  const at = postingResumesAt(cfg, now);
  return `Accepting submissions, posting is on hold. ${at ? `Resumes ${stamp(at)}.` : 'Resumes with `/mod resume`.'}`;
}

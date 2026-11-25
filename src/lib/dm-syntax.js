// DM shortcuts after the prefix:   fw #memes <message>   fw cw: spoilers | <message>   fw poll 24h: Question? | A | B
import { parsePollOptions } from './engagement.js';
import { MAX_CW_LEN } from './render.js';
import { TAGS } from './tags.js';

const KEYS = new Set(TAGS.map((t) => t.key));
export const dmTagList = () => TAGS.map((t) => `#${t.key}`).join(' ');

/** -> { text, tag, cw, pollOptions, pollHours, error }. Anything not recognised stays part of the message. */
export function parseDmPost(raw) {
  let text = (raw ?? '').trim();
  let tag = null;
  let cw = null;
  for (;;) {
    const t = text.match(/^#([a-z]+)\b\s*/i);
    if (t && !tag && KEYS.has(t[1].toLowerCase())) {
      tag = t[1].toLowerCase();
      text = text.slice(t[0].length);
      continue;
    }
    const c = text.match(/^cw\s*[:=]\s*([^|\n]+?)\s*\|\s*/i);
    if (c && !cw) {
      cw = c[1].slice(0, MAX_CW_LEN);
      text = text.slice(c[0].length);
      continue;
    }
    break;
  }

  let pollOptions = null;
  let pollHours = null;
  let error = null;
  const p = text.match(/^poll(?:\s+(\d{1,3})\s*h)?\s*:\s*([\s\S]*)$/i);
  if (p) {
    const [question, ...options] = p[2].split('|').map((s) => s.trim()).filter(Boolean);
    // No options = a yes/no question.
    const parsed = options.length ? parsePollOptions(options.join('\n')) : { options: ['Yes', 'No'] };
    if (!question) error = 'A poll needs a question: `poll: Question? | Option A | Option B`';
    else if (parsed.error || !parsed.options) error = parsed.error ?? 'A poll needs 2 to 5 options: `poll: Question? | Option A | Option B` (or just `poll: Question?` for yes/no)';
    else {
      text = question;
      pollOptions = parsed.options;
      if (p[1]) pollHours = Math.min(168, Math.max(1, Number(p[1])));
    }
  }
  return { text, tag, cw, pollOptions, pollHours, error };
}

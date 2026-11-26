// /mod queue, /mod stats and /mod search. Nothing here shows or counts who wrote a post.
import { EmbedBuilder } from 'discord.js';
import * as db from '../db.js';
import { COLOR, anonRef } from './format.js';
import { clockText, hasQuietHours, postingStatus } from './hours.js';
import { getTag, tagText } from './tags.js';

export const PAGE_SIZE = 8;
const DAY_MS = 86_400_000;
const rel = (ms) => `<t:${Math.floor(ms / 1000)}:R>`;

function excerpt(row) {
  if (row.purged_at) return '*(erased by data retention)*';
  const flat = (row.content ?? '').replace(/\s+/g, ' ').trim();
  if (!flat) return '*(image only)*';
  // No masked links or spoiler breaks from user text inside a staff view.
  const safe = flat.replace(/[[\]|]/g, '');
  return safe.length > 90 ? `${safe.slice(0, 89)}…` : safe;
}

/** One post as two lines. The Submission ID is what every /mod command takes. */
function entry(guildId, row) {
  const parts = [`**ID \`${row.sub_id}\`**`, row.number ? anonRef(row.number) : 'no number yet', row.status, rel(row.created_at)];
  if (row.thread_root) parts.push('thread reply');
  if (row.has_image) parts.push('🖼️');
  if (row.status !== 'deleted' && row.channel_id && row.message_id) {
    parts.push(`[jump](https://discord.com/channels/${guildId}/${row.channel_id}/${row.message_id})`);
  }
  return `${parts.join(' · ')}\n> ${excerpt(row)}`;
}

function listEmbed(guild, title, { rows, total }, page, empty, note) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const body = rows.length
    ? rows.map((r) => entry(guild.id, r)).join('\n')
    : total
      ? `Page ${page} is empty. There ${pages === 1 ? 'is 1 page' : `are ${pages} pages`}.`
      : empty;
  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(title)
    .setDescription([note, body].filter(Boolean).join('\n\n').slice(0, 4096))
    .setFooter({ text: `${total} found · page ${page} of ${pages}` });
}

/** Everything not up that could be: awaiting approval, hidden after reports, or saved until posting resumes. */
export function queueEmbed(guild, page = 1) {
  const found = db.listQueue(guild.id, PAGE_SIZE, (page - 1) * PAGE_SIZE);
  const note = found.total
    ? 'Pending: Approve or Reject on the mod-log entry. Hidden: `/mod restore` or `/mod delete`. Scheduled: posts when posting resumes, `/mod delete` to stop it.'
    : '';
  return listEmbed(guild, 'Moderation queue', found, page, 'Nothing is waiting. 🎉', note);
}

export function searchEmbed(guild, filters, page = 1) {
  const found = db.searchConfessions(guild.id, filters, PAGE_SIZE, (page - 1) * PAGE_SIZE);
  const used = [
    filters.text ? `text “${filters.text.replace(/[[\]|`]/g, '')}”` : null,
    filters.tag ? tagText(filters.tag) : null,
    filters.status ? `status ${filters.status}` : null,
    filters.since ? `since ${rel(filters.since)}` : null,
  ].filter(Boolean);
  return listEmbed(guild, 'Search results', found, page, 'No submission matches.', used.length ? `Filters: ${used.join(', ')}` : 'Newest submissions');
}

export function statsEmbed(guild, days = 30, now = Date.now()) {
  const s = db.guildStats(guild.id, now - days * DAY_MS);
  const cfg = db.getGuild(guild.id) ?? {};
  const count = (status) => s.byStatus.get(status) ?? 0;
  const total = [...s.byStatus.values()].reduce((a, b) => a + b, 0);
  const topics = s.topics.length
    ? s.topics.map((t) => `${getTag(t.tag) ? tagText(t.tag) : 'No topic'}: **${t.n}**`).join('\n')
    : 'No posts';
  const state = postingStatus(cfg, now);
  const quiet = hasQuietHours(cfg)
    ? `\nQuiet hours: ${clockText(cfg.quiet_start)} to ${clockText(cfg.quiet_end)} (${cfg.quiet_hold ? 'hold' : 'closed'})`
    : '';
  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(`Stats · last ${days} day${days === 1 ? '' : 's'}`)
    .addFields(
      { name: 'Submissions', value: `**${total}** (${(total / days).toFixed(1)} per day)\n${s.replies} replies · ${s.polls} polls · ${s.images} with images` },
      {
        name: 'Where they are now',
        value: `${count('posted')} posted · ${count('pending')} awaiting approval · ${count('scheduled')} scheduled · ${count('hidden')} hidden · ${count('deleted')} deleted · ${count('rejected')} rejected`,
      },
      { name: 'Top topics', value: topics },
      { name: 'Moderation', value: `${s.reports} reports · ${s.warnings} warnings · ${s.activeBans} active ban${s.activeBans === 1 ? '' : 's'} (now)` },
      {
        name: 'Queue right now',
        value: s.waiting ? `${s.waiting} waiting${s.oldestWaiting ? `, oldest from ${rel(s.oldestWaiting)}` : ''}. See \`/mod queue\`.` : 'Empty',
      },
      { name: 'Submissions are', value: `${state}${quiet}` },
    );
}

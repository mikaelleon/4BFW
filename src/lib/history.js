// /mod history: everything on record about the author of a submission (admin-only, ephemeral).
import { EmbedBuilder, time } from 'discord.js';
import * as db from '../db.js';
import { untilTag } from './duration.js';
import { COLOR, anonRef } from './format.js';

const SHOWN = 8; // entries per section; the rest is summarised so the embed stays inside Discord's limits
const rel = (ms) => time(Math.floor(ms / 1000), 'R');

const clip = (text, max) => {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** Join lines, then add "+N more" for what did not fit in the first SHOWN. */
function section(items, render, empty) {
  if (!items.length) return empty;
  const lines = items.slice(0, SHOWN).map(render);
  if (items.length > SHOWN) lines.push(`*+${items.length - SHOWN} more*`);
  return lines.join('\n').slice(0, 1024);
}

export function historyEmbed(guild, row) {
  const cfg = db.getGuild(guild.id);
  const userId = row.author_id;
  const posts = db.listConfessionsByAuthor(guild.id, userId);
  const warnings = db.listWarnings(guild.id, userId);
  const notes = db.listNotes(guild.id, userId);
  const ban = db.getBan(guild.id, userId);
  const active = db.countWarnings(guild.id, userId);
  const subOf = new Map(posts.map((p) => [p.id, p.sub_id])); // warnings and notes point at the internal key

  const banText = !ban ? 'Not banned' : ban.expires_at ? `Banned until ${untilTag(ban.expires_at)}` : 'Banned (permanent)';
  const expiry = cfg.warn_expiry_days > 0 ? ` (warnings expire after ${cfg.warn_expiry_days} days)` : '';

  const statusCount = (s) => posts.filter((p) => p.status === s).length;
  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(`History for the author of submission ${row.sub_id}`)
    .setDescription(`Sender ID: ||${userId}||\n${banText}\nActive warnings: **${active}/${cfg.warn_limit}**${expiry}`)
    .addFields(
      {
        name: `Submissions (${posts.length}: ${statusCount('posted')} posted, ${statusCount('hidden')} hidden, ${statusCount('deleted')} deleted)`,
        value: section(
          posts,
          (p) => {
            const reports = db.countReports(p.id);
            const tag = `${p.status}${reports ? `, ${reports} report${reports === 1 ? '' : 's'}` : ''}`;
            return `\`${p.sub_id}\` ${anonRef(p.number)} · ${tag} · ${rel(p.created_at)}\n> ${clip(p.content, 70) || '*(image only)*'}`;
          },
          'None',
        ),
      },
      {
        name: `Warnings (${warnings.length})`,
        value: section(
          warnings,
          (w) => `${w.expired ? '~~' : ''}${rel(w.created_at)}${subOf.get(w.confession_id) ? ` · ID \`${subOf.get(w.confession_id)}\`` : ''} · ${clip(w.reason, 80) || 'No reason'}${w.expired ? '~~ *(expired)*' : ''}`,
          'None',
        ),
      },
      {
        name: `Moderator notes (${notes.length})`,
        value: section(
          notes,
          (n) => `${rel(n.created_at)} · <@${n.moderator_id}>${subOf.get(n.confession_id) ? ` · ID \`${subOf.get(n.confession_id)}\`` : ''}\n> ${clip(n.note, 200)}`,
          'None. Add one with `/mod note`.',
        ),
      },
    );
}

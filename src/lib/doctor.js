// /setup doctor: checks the server's setup (channels, permissions, roles, settings that contradict each other,
// the ID secret) and lists what is fine, what is risky and what is broken, with the fix for each.
import { EmbedBuilder, PermissionFlagsBits as P } from 'discord.js';
import * as db from '../db.js';
import { COLOR } from './format.js';
import { uploadLimit } from './image.js';
import { usesTokenSecret } from './identity.js';
import { getTag } from './tags.js';
import { postingMode, postingStatus } from './hours.js';
import { THREAD_PERMS } from './threads.js';

const OK = '✅';
const WARN = '⚠️';
const BAD = '❌';
const INFO = 'ℹ️';

const PERM_NAMES = new Map(Object.entries(P).map(([name, bit]) => [bit, name.replace(/([a-z])([A-Z])/g, '$1 $2')]));
const missingNames = (channel, me, needed) => needed.filter((p) => !channel.permissionsFor(me)?.has(p)).map((p) => PERM_NAMES.get(p) ?? String(p));

const POST_PERMS = [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.AttachFiles, P.ReadMessageHistory];
const LOG_PERMS = [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.AttachFiles];

/** One line per check; `level` is OK / WARN / BAD / INFO. */
const line = (level, text) => ({ level, text });

async function channelCheck(guild, me, id, label, needed, fix) {
  const channel = await guild.channels.fetch(id).catch(() => null);
  if (!channel) return { channel: null, lines: [line(BAD, `${label}: the channel was deleted or I cannot see it. ${fix}`)] };
  const missing = missingNames(channel, me, needed);
  if (missing.length) return { channel, lines: [line(BAD, `${label} <#${id}>: I am missing **${missing.join(', ')}**.`)] };
  return { channel, lines: [line(OK, `${label} <#${id}>: permissions are fine.`)] };
}

export async function runDoctor(guild) {
  const cfg = db.getGuild(guild.id) ?? {};
  const me = guild.members.me ?? (await guild.members.fetchMe());
  const sections = { Channels: [], Roles: [], Settings: [], 'Privacy and data': [] };

  /* ---- channels ---- */
  if (!cfg.channel_id) {
    sections.Channels.push(line(BAD, 'No submissions channel. Run `/setup channel`.'));
  } else {
    const main = await channelCheck(guild, me, cfg.channel_id, 'Submissions channel', POST_PERMS, 'Run `/setup channel` again.');
    sections.Channels.push(...main.lines);
    if (main.channel) {
      if (main.channel.permissionsFor(guild.roles.everyone)?.has(P.SendMessages)) {
        sections.Channels.push(line(WARN, 'Everyone can type in the submissions channel. Deny **Send Messages** for @everyone so only the bot posts there.'));
      }
      if (cfg.sticky_id) {
        const sticky = await main.channel.messages.fetch(cfg.sticky_id).catch(() => null);
        if (!sticky) sections.Channels.push(line(WARN, 'The "Write a Submission" button message is gone. Run `/setup refresh`.'));
      } else {
        sections.Channels.push(line(WARN, 'The "Write a Submission" button message is not posted. Run `/setup refresh`.'));
      }
    }
  }

  if (!cfg.log_channel_id) {
    sections.Channels.push(line(WARN, 'No mod log. Moderators cannot see new posts, reports or appeals. Run `/setup modlog`.'));
  } else {
    const log = await channelCheck(guild, me, cfg.log_channel_id, 'Mod log', LOG_PERMS, 'Run `/setup modlog` again.');
    sections.Channels.push(...log.lines);
    if (log.channel?.permissionsFor(guild.roles.everyone)?.has(P.ViewChannel)) {
      sections.Channels.push(line(BAD, 'Everyone can read the mod log, and it shows sender IDs. Make the channel staff-only.'));
    }
  }

  for (const [label, id, fix] of [
    ['Featured channel', cfg.featured_channel_id, 'Run `/setup featured` again or `off:true`.'],
    ['Highlights channel', cfg.highlight_channel_id && cfg.highlight_period !== 'off' ? cfg.highlight_channel_id : null, 'Run `/setup highlights` again.'],
  ]) {
    if (id) sections.Channels.push(...(await channelCheck(guild, me, id, label, LOG_PERMS, fix)).lines);
  }
  for (const route of db.listTagChannels(guild.id)) {
    const name = getTag(route.tag)?.label ?? route.tag;
    sections.Channels.push(...(await channelCheck(guild, me, route.channel_id, `Topic channel (${name})`, POST_PERMS, 'Run `/setup tagchannel` again.')).lines);
  }

  if (cfg.auto_thread) {
    const ids = [cfg.channel_id, ...db.listTagChannels(guild.id).map((r) => r.channel_id)].filter(Boolean);
    for (const id of new Set(ids)) {
      const channel = await guild.channels.fetch(id).catch(() => null);
      const missing = channel ? missingNames(channel, me, THREAD_PERMS) : [];
      if (missing.length) sections.Channels.push(line(BAD, `Reply threads <#${id}>: I am missing **${missing.join(', ')}**.`));
    }
  }

  /* ---- roles ---- */
  for (const [label, id, fix] of [
    ['Moderator role', cfg.mod_role_id, '`/setup modrole`'],
    ['Guide role', cfg.role_id, '`/setup role`'],
    ['Online notice role', cfg.online_role_id, '`/setup onlinerole`'],
  ]) {
    if (!id) continue;
    const role = await guild.roles.fetch(id).catch(() => null);
    sections.Roles.push(role ? line(OK, `${label}: **${role.name}**.`) : line(BAD, `${label} was deleted. Set it again with ${fix}.`));
  }
  if (!cfg.mod_role_id) sections.Roles.push(line(INFO, 'No moderator role: only members with **Manage Server** can moderate. `/setup modrole` lets a role do it.'));
  if (!sections.Roles.length) sections.Roles.push(line(INFO, 'No roles configured.'));

  /* ---- settings that fight each other ---- */
  const rules = db.listFilterRules(guild.id).length;
  if (cfg.approval_mode) {
    sections.Settings.push(
      cfg.log_channel_id
        ? line(INFO, 'Approval queue is **on**: posts wait for a moderator, which differs from the guide text ("posts go up first").')
        : line(BAD, 'Approval queue is **on** but there is no mod log, so nobody can approve anything. Run `/setup modlog` or turn approval off.'),
    );
  }
  if (cfg.filter_action === 'hold' && (rules || cfg.block_invites || cfg.block_links) && !cfg.log_channel_id) {
    sections.Settings.push(line(BAD, 'The filter holds posts for review but there is no mod log. Held posts would never be seen.'));
  }
  if (cfg.report_limit > 0 && !cfg.log_channel_id) {
    sections.Settings.push(line(WARN, 'Posts auto-hide after reports but there is no mod log to review them in.'));
  }
  if (cfg.channel_id && postingMode(cfg) !== 'open') sections.Settings.push(line(INFO, postingStatus(cfg).replace(/\n/g, ' ')));
  const saved = db.countScheduled(guild.id);
  if (saved > 0) sections.Settings.push(line(INFO, `${saved} saved submission${saved === 1 ? ' is' : 's are'} waiting for posting to resume (\`/mod queue\`).`));
  if (cfg.cooldown === 0) sections.Settings.push(line(WARN, 'Cooldown is 0: people can post as fast as they like.'));
  const pending = db.countPending(guild.id);
  if (pending > 0) sections.Settings.push(line(WARN, `${pending} submission${pending === 1 ? ' is' : 's are'} waiting for a moderator in the mod log.`));
  const gates = [
    cfg.min_join_days > 0 ? `joined ${cfg.min_join_days}+ days ago` : null,
    cfg.min_account_days > 0 ? `account ${cfg.min_account_days}+ days old` : null,
    cfg.daily_cap > 0 ? `${cfg.daily_cap} posts / 24 h` : null,
    cfg.dup_hours > 0 ? `no repeats within ${cfg.dup_hours} h` : null,
  ].filter(Boolean);
  sections.Settings.push(line(INFO, `Anti-spam: cooldown ${cfg.cooldown ?? 30}s${gates.length ? `, ${gates.join(', ')}` : ', no other limits'}.`));
  sections.Settings.push(line(INFO, `Image upload limit in this server: ${(uploadLimit(guild) / 1_048_576).toFixed(0)} MB.`));

  /* ---- privacy / data ---- */
  if (!db.secretMatches()) {
    sections['Privacy and data'].push(line(BAD, 'The ID hash secret changed since the database was written, so existing bans, warnings and notes no longer match their users. Restore the old `ID_HASH_SECRET` (or token).'));
  } else if (usesTokenSecret()) {
    sections['Privacy and data'].push(line(WARN, 'The ID hash secret comes from `DISCORD_TOKEN`. Resetting the token would break every ban and warning. Pin it with `ID_HASH_SECRET` in `.env`.'));
  } else {
    sections['Privacy and data'].push(line(OK, 'ID hash secret is pinned with `ID_HASH_SECRET`.'));
  }
  sections['Privacy and data'].push(
    cfg.retention_days > 0
      ? line(INFO, `Data retention: sender ID, text and images are erased after ${cfg.retention_days} days.`)
      : line(INFO, 'Data retention is off: sender IDs and text are kept until you set `/setup options retention_days`.'),
  );

  /* ---- result ---- */
  const all = Object.values(sections).flat();
  const bad = all.filter((l) => l.level === BAD).length;
  const warn = all.filter((l) => l.level === WARN).length;
  const embed = new EmbedBuilder()
    .setColor(bad ? 0xed4245 : warn ? 0xfee75c : 0x57f287)
    .setTitle(`Setup check for ${guild.name}`)
    .setDescription(
      bad || warn
        ? `${bad} problem${bad === 1 ? '' : 's'}, ${warn} warning${warn === 1 ? '' : 's'}. Fix the ${BAD} items first.`
        : 'Everything looks fine.',
    );
  for (const [name, lines] of Object.entries(sections)) {
    if (!lines.length) continue;
    // Problems first, then the rest, so a long list cuts off the least important lines.
    const rank = { [BAD]: 0, [WARN]: 1, [INFO]: 2, [OK]: 3 };
    const text = [...lines].sort((a, b) => rank[a.level] - rank[b.level]).map((l) => `${l.level} ${l.text}`).join('\n');
    embed.addFields({ name, value: text.length > 1024 ? `${text.slice(0, 1020)}…` : text });
  }
  return embed;
}

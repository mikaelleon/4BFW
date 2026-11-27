// The /setup view embed: current settings grouped into sections. One full-width field per section, so it reads the
// same on a phone and on a desktop. No emojis here: topic names are shown by label only.
import { EmbedBuilder } from 'discord.js';
import * as db from '../db.js';
import { COLOR, anonRef } from './format.js';
import { clockText, hasQuietHours, postingStatus } from './hours.js';
import { hasPin } from './owner-pin.js';
import { getTag } from './tags.js';

const FIELD_LIMIT = 1024;
const HIGHLIGHTS = { daily: 'Daily', weekly: 'Weekly', both: 'Daily and weekly' };

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const channel = (id) => (id ? `<#${id}>` : 'Not set');
const role = (id) => (id ? `<@&${id}>` : 'Not set');
const onOff = (value) => (value ? 'On' : 'Off');

/** A section from [label, value] pairs: one "Label: **value**" line each. */
const section = (name, rows) => ({ name, value: rows.map(([label, value]) => `${label}: **${value}**`).join('\n') });

/** Topic routes, cut at a whole line if they would not fit in one field. */
function topicLines(routes) {
  if (!routes.length) return 'All topics go to the submissions channel.';
  const lines = routes.map((r) => `${getTag(r.tag)?.label ?? r.tag}: <#${r.channel_id}>`);
  let shown = lines.length;
  const text = () => {
    const rest = lines.length - shown;
    return [...lines.slice(0, shown), ...(rest ? [`and ${rest} more`] : [])].join('\n');
  };
  while (shown > 1 && text().length > FIELD_LIMIT) shown--;
  return text();
}

function filterSummary(c, ruleCount) {
  if (!ruleCount && !c.block_invites && !c.block_links) return 'Off';
  const parts = ruleCount ? [plural(ruleCount, 'rule')] : [];
  if (c.block_invites) parts.push('invites blocked');
  if (c.block_links) parts.push('links blocked');
  return `${parts.join(', ')} (${c.filter_action === 'hold' ? 'hold for review' : 'reject'})`;
}

export function settingsEmbed(guild, now = Date.now()) {
  const c = db.getGuild(guild.id) ?? {};
  const highlight =
    c.highlight_channel_id && HIGHLIGHTS[c.highlight_period]
      ? `${HIGHLIGHTS[c.highlight_period]} in <#${c.highlight_channel_id}>`
      : 'Off';
  const quiet = hasQuietHours(c)
    ? `${clockText(c.quiet_start)} to ${clockText(c.quiet_end)} ${process.env.TIMEZONE || 'Asia/Manila'} (${c.quiet_hold ? 'hold' : 'closed'})`
    : 'Off';

  // A paused status can carry a reason on a second line: only the first line is bold.
  const [status, ...statusRest] = postingStatus(c, now).split('\n');

  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(`Settings for ${guild.name}`.slice(0, 256))
    .setDescription(
      [`Next public number: **${anonRef((c.counter ?? 0) + 1)}**`, `Submissions: **${status}**`, ...statusRest].join('\n'),
    )
    .addFields(
      section('Channels', [
        ['Submissions', channel(c.channel_id)],
        ['Mod log', channel(c.log_channel_id)],
        ['Featured', c.featured_channel_id ? `<#${c.featured_channel_id}> at ${plural(c.featured_threshold, 'like')}` : 'Off'],
        ['Post of the day / week', highlight],
      ]),
      { name: 'Topic channels', value: topicLines(db.listTagChannels(guild.id)) },
      section('Roles', [
        ['Moderator', role(c.mod_role_id)],
        ['Guide', role(c.role_id)],
        ['Online notice', role(c.online_role_id)],
      ]),
      section('Posting', [
        ['Cooldown', plural(c.cooldown ?? 30, 'second')],
        ['Daily post cap', c.daily_cap > 0 ? `${c.daily_cap} per 24 hours` : 'Off'],
        ['Repost blocker', c.dup_hours > 0 ? `Same text within ${plural(c.dup_hours, 'hour')}` : 'Off'],
        ['Minimum time in server', c.min_join_days > 0 ? plural(c.min_join_days, 'day') : 'Off'],
        ['Minimum account age', c.min_account_days > 0 ? plural(c.min_account_days, 'day') : 'Off'],
        ['Poll length', c.poll_hours > 0 ? plural(c.poll_hours, 'hour') : 'Until closed'],
        ['Reply threads', onOff(c.auto_thread)],
        ['Quiet hours', quiet],
      ]),
      section('Moderation', [
        ['Approval queue', c.approval_mode ? 'On (posts wait for a moderator)' : 'Off (post first, moderate after)'],
        ['Auto-filter', filterSummary(c, db.listFilterRules(guild.id).length)],
        ['Auto-hide', c.report_limit > 0 ? `At ${plural(c.report_limit, 'report')}` : 'Off'],
        ['Warn limit', plural(c.warn_limit ?? 3, 'warning')],
        ['Warning expiry', c.warn_expiry_days > 0 ? plural(c.warn_expiry_days, 'day') : 'Never'],
        ['Self-delete window', c.self_delete_minutes > 0 ? plural(c.self_delete_minutes, 'minute') : 'Off'],
        ['Data retention', c.retention_days > 0 ? plural(c.retention_days, 'day') : 'Keep forever'],
      ]),
      section('Other', [
        ['Welcome DM', onOff(c.welcome_dm)],
        ['Owner PIN', hasPin(guild.id) ? 'Set' : 'Not set (owner: run /ownerpin)'],
      ]),
    );
}

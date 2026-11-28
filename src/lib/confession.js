import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  FileUploadBuilder,
  LabelBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import * as db from '../db.js';
import { dmUser, modLog, notice } from './moderation.js';
import { COLOR, anonRef, anonTitle, footerLine, prefix, randomSubmissionColor, topicShade } from './format.js';
import { PAD_NAME, padPng } from './pad.js';
import { imageHelp, uploadLimit } from './image.js';
import { checkFilters } from './filter.js';
import { DUPLICATE_MESSAGE, checkDailyCap, checkEligibility, isDuplicate } from './gates.js';
import { removeFeatured } from './featured.js';
import { closedNotice, holdPrompt, postingMode, postingResumesAt } from './hours.js';
import { userKey } from './identity.js';
import { closeThread, ensureThread, openChannel } from './threads.js';
import { MAX_CW_LEN, postFiles, renderBody } from './render.js';
import { TAGS, getTag, tagText } from './tags.js';

export const MAX_LEN = 2000;
/** While posting is on hold, how many submissions one person can have waiting. */
export const MAX_WAITING = 3;
export const OPEN_BUTTON_ID = 'confess:open';
export const GUIDE_BUTTON_ID = 'confess:guide';
export const MODAL_ID = 'confess:modal';
export { prefix };
export const REPLY_BUTTON_ID = 'confess:reply';
export const REPORT_BUTTON_ID = 'confess:report';
export const REACT_PREFIX = 'confess:react'; // "confess:react:up|down"
export const VOTE_PREFIX = 'confess:vote'; // "confess:vote:<option index>"
export const MAX_POLL_OPTIONS = 5;
export const YES_NO = ['Yes', 'No'];
// 5-point Likert scale. Fits exactly in one row of buttons (Discord allows 5), which is why 7-point scales are not offered.
export const LIKERT = ['Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree'];
export const POLL_KINDS = [
  { key: 'yesno', label: 'Yes / No', description: 'A simple yes-or-no question' },
  { key: 'choice', label: 'Multiple choice', description: '2 to 5 options you type next' },
  { key: 'likert', label: 'Likert scale', description: 'Strongly disagree to strongly agree' },
];
export const OPTIONS_MODAL_PREFIX = 'confess:options'; // modal "confess:options:<token>"
export const OPTIONS_BUTTON_PREFIX = 'confess:addoptions'; // button "confess:addoptions:<token>"
const NUMBER_EMOJI = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];
/** A poll whose options are exactly Yes / No gets ✅ ❌ buttons; anything else gets numbered buttons. */
export const isYesNo = (options) => options.length === 2 && options[0].label.toLowerCase() === 'yes' && options[1].label.toLowerCase() === 'no';
export const CLOSE_POLL_ID = 'confess:closepoll';
export const APPROVAL_PREFIX = 'approval'; // buttons "approval:<ok|no>:<confession id>" on a pending submission
const jumpUrl = (guildId, row) => `https://discord.com/channels/${guildId}/${row.channel_id}/${row.message_id}`;

/* One queue per guild so numbering and the sticky message stay in order. */
const locks = new Map();
function withLock(key, fn) {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  locks.set(key, next);
  next.catch(() => {}).finally(() => {
    if (locks.get(key) === next) locks.delete(key);
  });
  return next;
}

const fail = (error) => ({ ok: false, error });

/* ---------- embeds / components ---------- */

/** Submission post: random color, and a transparent wide image (see pad.js) so every post has the same width. */
export function confessionEmbed(number, content, color, imageName = PAD_NAME, tag = null, poll = {}) {
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(anonTitle(number))
    .setImage(`attachment://${imageName}`) // the user's image, or the transparent pad when there is none
    .setFooter({ text: footerLine() });
  if (content) embed.setDescription(content);
  const text = tagText(tag);
  if (text) embed.setAuthor({ name: text }); // the topic, shown above the title
  if (poll.options?.length) {
    embed.addFields({ name: 'Options', value: poll.options.map((o, i) => `${NUMBER_EMOJI[i]} ${o.label}`).join('\n') });
  }
  if (poll.closed) embed.addFields({ name: 'Poll', value: 'Closed. Results are in the reply below.' });
  else if (poll.endsAt) embed.addFields({ name: 'Poll', value: `Closes <t:${Math.floor(poll.endsAt / 1000)}:R>` });
  return embed;
}

/** Heading of a stored post: thread replies lead with the alias, the post author's channel replies end with "OP". */
export function postTitle(row) {
  if (row.thread_root && row.alias) return `${row.alias} · ${anonRef(row.number)}`;
  return row.alias ? `${anonTitle(row.number)} · ${row.alias}` : anonTitle(row.number);
}

/** The whole public post (embed, files, buttons) for a stored row. Used to post, restore and re-render. */
export async function buildPost(row, image) {
  const { files, imageName } = postFiles(image, row.cw);
  const pollOptions = row.is_poll ? await db.getPollOptions(row.id) : null;
  const embed = confessionEmbed(row.number, renderBody(row.rendered ?? row.content, row.cw), row.color ?? COLOR, imageName, row.tag, {
    endsAt: row.poll_ends_at,
    closed: Boolean(row.poll_closed_at),
    options: pollOptions && !isYesNo(pollOptions) ? pollOptions : null, // listed in the embed; the buttons just carry numbers
  });
  embed.setTitle(postTitle(row));
  return { embeds: [embed], files, components: await postComponents(row), allowedMentions: { parse: [] } };
}

const reactionButton = (kind, emoji, count) => {
  const button = new ButtonBuilder().setCustomId(`${REACT_PREFIX}:${kind}`).setEmoji(emoji).setStyle(ButtonStyle.Secondary);
  return count > 0 ? button.setLabel(String(count)) : button;
};

/**
 * Buttons under a post: Reply, Report and the 👍 👎 counters, plus a poll row: ✅ Yes / ❌ No, or 1️⃣ 2️⃣ … for several options.
 * No confession ID in any custom id: the target is read from the message the button sits on.
 * Rebuilt from the database whenever a count changes.
 */
export async function postComponents(row) {
  const counts = await db.reactionCounts(row.id);
  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(REPLY_BUTTON_ID).setLabel('Reply').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(REPORT_BUTTON_ID).setLabel('Report').setStyle(ButtonStyle.Secondary),
      reactionButton('up', '👍', counts.up),
      reactionButton('down', '👎', counts.down),
    ),
  ];
  if (row.is_poll) {
    const closed = Boolean(row.poll_closed_at);
    const votes = await db.pollCounts(row.id);
    const options = await db.getPollOptions(row.id);
    const yesNo = isYesNo(options);
    const total = options.reduce((sum, o) => sum + (votes.get(o.idx) ?? 0), 0);
    rows.push(
      new ActionRowBuilder().addComponents(
        options.map((o, i) => {
          const n = votes.get(o.idx) ?? 0;
          const share = total ? ` (${Math.round((n / total) * 100)}%)` : '';
          return new ButtonBuilder()
            .setCustomId(`${VOTE_PREFIX}:${o.idx}`)
            .setEmoji(yesNo ? (i === 0 ? '✅' : '❌') : NUMBER_EMOJI[i])
            .setLabel(`${yesNo ? `${o.label} · ` : ''}${n}${share}`)
            .setStyle(closed ? ButtonStyle.Secondary : ButtonStyle.Primary)
            .setDisabled(closed);
        }),
      ),
    );
    if (!closed) {
      rows.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(CLOSE_POLL_ID).setLabel('Close poll').setStyle(ButtonStyle.Secondary),
        ),
      );
    }
  }
  return rows;
}

/**
 * Turn "#012" mentions into jump links to that confession (current numbering, newest match),
 * and prepend a "Replying to" line when the Reply button was used.
 */
async function linkReferences(guildId, content, replyToMessageId) {
  const targets = new Map(); // confession id -> row, everything this post replies to or mentions
  let linked = 0;
  // Look the numbers up first: String.replace cannot wait for the database.
  const found = new Map();
  for (const [, n] of content.matchAll(/#(\d{1,6})\b/g)) {
    if (found.size >= 50) break;
    if (!found.has(n)) found.set(n, await db.getLatestPostedByNumber(guildId, Number(n)));
  }
  let body = content.replace(/#(\d{1,6})\b/g, (match, n) => {
    if (linked >= 5) return match;
    const row = found.get(n);
    if (!row) return match;
    linked++;
    targets.set(row.id, row);
    return `[${anonRef(row.number)}](${jumpUrl(guildId, row)})`;
  });

  if (replyToMessageId) {
    const target = await db.getConfessionByMessage(guildId, replyToMessageId);
    if (target && target.status === 'posted') {
      targets.set(target.id, target);
      body = `> Replying to [${anonTitle(target.number)}](${jumpUrl(guildId, target)})\n\n${body}`;
    }
  }
  return { body, targets: [...targets.values()] };
}

/** DM the author of each post that was replied to (once per author, never the replier themselves). */
async function notifyReplies(client, guild, targets, replierId, content, url) {
  const text = content || '*(image)*';
  const excerpt = text.length > 300 ? `${text.slice(0, 300)}…` : text;
  const quoted = excerpt
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
  const notified = new Set();
  for (const target of targets) {
    if (!target.author_id || target.author_id === replierId || notified.has(target.author_id)) continue; // empty = purged
    if ((await db.getPrefs(target.author_id)).notify_off) continue; // /fw notify:off
    notified.add(target.author_id);
    await dmUser(
      client,
      target.author_id,
      notice(
        `Someone replied to your ${anonTitle(target.number)}`,
        `In **${guild.name}**:\n\n${quoted}\n\n[View the reply](${url})`,
      ),
    );
  }
}

function stickyPayload() {
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(COLOR)
        .setDescription(
          [
            '**STFW** · *noun* `/ˌɛs-ti-ɛf-ˈdʌbəl-ju/`',
            '> ***S**erver **T**houghts **F**reedom **W**all*; an anonymous outlet for unfiltered thoughts and confessions.',
            "*When you're told to STFU, let STFW do the talking instead.*",
            '',
            `-# tap **Write a Submission** below · or \`/fw\` · or DM me \`${prefix()} <message>\``,
          ].join('\n'),
        ),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(OPEN_BUTTON_ID).setLabel('Write a Submission').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(GUIDE_BUTTON_ID).setLabel('View Guide').setStyle(ButtonStyle.Secondary),
      ),
    ],
    allowedMentions: { parse: [] },
  };
}

/** `reply` = { messageId, number, own } when answering a specific confession; `own` = it is the clicker's own post. */
export function confessModal(reply = null) {
  const modal = new ModalBuilder()
    .setCustomId(reply ? `${MODAL_ID}:${reply.messageId}` : MODAL_ID)
    .setTitle(reply ? `Reply to ${anonTitle(reply.number)}` : 'Write a submission')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Topic (optional)')
        .setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId('tag')
            .setPlaceholder('Pick a topic')
            .setRequired(false)
            .setMinValues(0)
            .setMaxValues(1)
            .addOptions(TAGS.map((t) => ({ label: t.label, value: t.key, emoji: t.emoji }))),
        ),
      new LabelBuilder().setLabel('Your submission').setTextInputComponent(
        new TextInputBuilder()
          .setCustomId('text')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Nobody will know it was you.')
          .setMaxLength(MAX_LEN)
          .setRequired(false), // may be empty when an image is attached; submitConfession rejects "nothing at all"
      ),
      new LabelBuilder()
        .setLabel('Image (optional)')
        .setDescription('PNG, JPG, GIF or WEBP')
        .setFileUploadComponent(new FileUploadBuilder().setCustomId('image').setMinValues(0).setMaxValues(1).setRequired(false)),
    );
  modal.addLabelComponents(
    new LabelBuilder()
      .setLabel('Content warning (optional)')
      .setDescription('Hides your text behind a spoiler, e.g. "violence" or "spoilers".')
      .setTextInputComponent(new TextInputBuilder().setCustomId('cw').setStyle(TextInputStyle.Short).setMaxLength(MAX_CW_LEN).setRequired(false)),
  );
  if (reply?.own) {
    // Only the author of the post sees this. Off unless chosen: the tag links this reply to their post.
    modal.addLabelComponents(
      new LabelBuilder()
        .setLabel('Reply as OP? (optional)')
        .setDescription('OP shows everyone that the author of this post wrote the reply.')
        .setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId('op')
            .setPlaceholder('No, stay unmarked')
            .setRequired(false)
            .setMinValues(0)
            .setMaxValues(1)
            .addOptions({ label: 'Yes, mark me as OP', value: 'yes' }, { label: 'No, stay unmarked', value: 'no' }),
        ),
    );
  }
  if (!reply) {
    // Picking a type turns the submission into a poll: the text above is the question. (A modal holds at most 5 inputs, so
    // "Multiple choice" asks for its options in a second pop-up, see optionsModal.)
    modal.addLabelComponents(
      new LabelBuilder()
        .setLabel('Poll (optional)')
        .setDescription('Turn your submission into a poll. The text above is the question.')
        .setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId('pollkind')
            .setPlaceholder('No poll')
            .setRequired(false)
            .setMinValues(0)
            .setMaxValues(1)
            .addOptions(POLL_KINDS.map((k) => ({ label: k.label, description: k.description, value: k.key }))),
        ),
    );
  }
  return modal;
}

/** Second pop-up for a multiple-choice poll: the options, one per line. `token` ties it to the saved first step. */
export function optionsModal(token) {
  return new ModalBuilder()
    .setCustomId(`${OPTIONS_MODAL_PREFIX}:${token}`)
    .setTitle('Poll options')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Options, one per line')
        .setDescription(`2 to ${MAX_POLL_OPTIONS} options.`)
        .setTextInputComponent(
          new TextInputBuilder().setCustomId('options').setStyle(TextInputStyle.Paragraph).setMaxLength(300).setRequired(true),
        ),
    );
}

/* ---------- sticky "button" message at the bottom of the channel ---------- */

async function postSticky(guild) {
  const cfg = await db.getGuild(guild.id);
  if (!cfg?.channel_id) return;
  const channel = await guild.channels.fetch(cfg.channel_id).catch(() => null);
  if (!channel) return;
  if (cfg.sticky_id) await channel.messages.delete(cfg.sticky_id).catch(() => {});
  const msg = await channel.send(stickyPayload());
  await db.updateGuild(guild.id, { sticky_id: msg.id });
}

export const refreshSticky = (guild) => withLock(guild.id, () => postSticky(guild));

/** Repost the sticky only if it vanished (used on startup). */
export const ensureSticky = (guild) =>
  withLock(guild.id, async () => {
    const cfg = await db.getGuild(guild.id);
    if (!cfg?.channel_id) return;
    const channel = await guild.channels.fetch(cfg.channel_id).catch(() => null);
    if (!channel) return;
    const exists = cfg.sticky_id && (await channel.messages.fetch(cfg.sticky_id).catch(() => null));
    if (!exists) await postSticky(guild);
  });

/** Remove the sticky from the (old) channel without reposting. */
export async function removeSticky(guild) {
  const cfg = await db.getGuild(guild.id);
  if (!cfg?.channel_id || !cfg.sticky_id) return;
  const channel = await guild.channels.fetch(cfg.channel_id).catch(() => null);
  await channel?.messages.delete(cfg.sticky_id).catch(() => {});
  await db.updateGuild(guild.id, { sticky_id: null });
}

/* ---------- submitting ---------- */

/** Pending submission: Approve / Reject buttons for the mod log. */
export const approvalRow = (id) =>
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${APPROVAL_PREFIX}:ok:${id}`).setLabel('Approve').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${APPROVAL_PREFIX}:no:${id}`).setLabel('Reject').setStyle(ButtonStyle.Danger),
  );

/** Extra mod-log fields describing a post: content warning and thread. (Topic and poll marker are added by modLog.) */
async function logFields(row) {
  const root = row.thread_root ? await db.getConfession(row.guild_id, row.thread_root) : null;
  return [
    ...(root ? [{ name: 'Thread reply under', value: anonRef(root.number), inline: true }] : []),
    ...(row.cw ? [{ name: 'Content warning', value: row.cw, inline: true }] : []),
  ];
}

/**
 * Send a stored post to its channel (the topic's own channel when /setup tagchannel set one).
 * Returns { msg, targets, row } or { error }. Call while holding the guild lock.
 */
async function publish(guild, row) {
  const cfg = await db.getGuild(guild.id);
  const me = guild.members.me ?? (await guild.members.fetchMe());
  const needed = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];
  const usable = (c) => c && c.permissionsFor(me)?.has(needed);
  let channel;
  let root = null;
  if (row.thread_root) {
    root = await db.getConfession(guild.id, row.thread_root);
    if (!root || root.status !== 'posted') return { error: 'That submission is no longer available to reply to.', gone: root?.status !== 'hidden' };
    const opened = await ensureThread(guild, root);
    if (opened.error) return opened;
    channel = opened.thread;
    if (channel.locked) return { error: 'Replies are closed on that submission.', gone: true };
    if (!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessagesInThreads, PermissionFlagsBits.EmbedLinks])) {
      return { error: 'I cannot post in that thread right now. Tell an admin.' };
    }
  } else {
    // If the topic's channel is gone or off-limits, use the main channel.
    const topicId = row.tag ? await db.getTagChannel(guild.id, row.tag) : null;
    channel = topicId ? await guild.channels.fetch(topicId).catch(() => null) : null;
    if (!usable(channel)) channel = await guild.channels.fetch(cfg.channel_id).catch(() => null);
    if (!usable(channel)) return { error: 'I cannot post in the submissions channel right now. Tell an admin.' };
  }

  const image = row.has_image ? await db.getConfessionImage(row.id) : null;
  const { body, targets } = await linkReferences(guild.id, row.content, row.reply_to);
  // The author of the thread's post hears about every reply in it, also replies to other replies.
  if (root && !targets.some((t) => t.id === root.id)) targets.push(root);
  // Alias is fixed when the reply goes up: "OP" when the post's author chose it, else their number in this thread.
  if (row.op_tag) await db.setAlias(row.id, 'OP');
  else if (root) await db.setAlias(row.id, `Anon ${await db.threadAlias(root.id, row.author_key)}`);
  // Tagged posts get a shade of their topic's color, untagged ones a random gray.
  const topic = getTag(row.tag);
  const color = topic ? topicShade(topic.color, `${guild.id}:${topic.key}`) : randomSubmissionColor(guild.id);
  await db.setConfessionRendered(row.id, body, color);
  const full = await db.getConfession(guild.id, row.id);
  let msg;
  try {
    msg = await channel.send(await buildPost(full, image));
  } catch (err) {
    console.error('Failed to post confession:', err);
    return { error: 'Discord refused the post. Try again in a bit.', refused: true };
  }
  await db.setConfessionMessage(guild.id, row.id, channel.id, msg.id);
  return { msg, targets, row: await db.getConfession(guild.id, row.id) };
}

/** Everything that follows a post going live: the mod-log entry, the sticky, reply DMs. */
async function afterPublish(guild, row, msg, targets, { title, actor } = {}) {
  // Admin-only: the ID appears in the mod log, never in the public channel.
  await modLog(guild, {
    title,
    actor,
    id: row.id,
    subId: row.sub_id,
    number: row.number,
    url: msg.url,
    content: row.content,
    authorId: row.author_id,
    hasImage: Boolean(row.has_image),
    controls: true,
    fields: await logFields(row),
  }).catch(() => {});
  if (!row.thread_root) {
    // A thread under every new post when the server wants them. A failure only costs the thread, not the post.
    if ((await db.getGuild(guild.id))?.auto_thread) await ensureThread(guild, row);
    await postSticky(guild).catch((err) => console.error('Failed to refresh sticky:', err));
  }
  // Fire and forget: DMs can be slow or closed, and must not delay the reply to the sender.
  notifyReplies(guild.client, guild, targets, row.author_id, row.content, msg.url).catch((err) => console.error('Reply notify failed:', err));
}

/**
 * Why this person may not post here right now (not a member, banned, closed, too new, cooldown, daily cap), or null. Also asked
 * before an image is downloaded, so someone who cannot post cannot make the bot fetch and hold files.
 */
export async function whyCannotPost(guild, userId) {
  const cfg = await db.getGuild(guild.id);
  if (!cfg?.channel_id) return 'Submissions are not set up in this server yet.';
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return 'You are not a member of that server.';
  if (await db.getBan(guild.id, userId)) return 'You are banned from posting in this server.';

  const closed = closedNotice(cfg);
  if (closed) return closed;
  if (postingMode(cfg) === 'hold' && await db.countWaiting(guild.id, userId) >= MAX_WAITING) {
    return `You already have ${MAX_WAITING} submissions waiting to be posted. Send more after posting resumes.`;
  }

  const tooNew = checkEligibility(member, cfg);
  if (tooNew) return tooNew;

  const waitMs = await db.lastConfessionAt(guild.id, userId) + cfg.cooldown * 1000 - Date.now();
  if (waitMs > 0) return `Slow down. Try again in ${Math.ceil(waitMs / 1000)}s.`;

  return await checkDailyCap(guild.id, userId, cfg);
}

/**
 * `image` = { buffer, name } (re-uploaded into the channel).
 * `extras` = { tag, pollOptions, pollHours, cw }: topic key, poll option labels (+ how long it stays open),
 * and a content warning label.
 * Result: { ok: true, number, url } when posted, { ok: true, pending: true } when it waits for a moderator
 * (approval mode, or held by the filter), { ok: true, scheduled: true } when saved until posting resumes,
 * { ok: false, needsConfirm: true, prompt } when posting is on hold and the author has not agreed to wait
 * (`extras.acceptDelay`; nothing is saved), { ok: false, error } otherwise.
 */
export function submitConfession(guild, userId, rawContent, replyToMessageId = null, image = null, extras = {}) {
  return withLock(guild.id, async () => {
    const cfg = await db.getGuild(guild.id);
    if (!cfg?.channel_id) return fail('Submissions are not set up in this server yet.');

    const content = (rawContent ?? '').trim();
    if (!content && !image) return fail('Write something first.');
    if (content.length > MAX_LEN) return fail(`Too long. Max ${MAX_LEN} characters.`);

    const tag = getTag(extras.tag)?.key ?? null;
    const cw = (extras.cw ?? '').trim().slice(0, MAX_CW_LEN) || null;
    const pollOptions = extras.pollOptions?.length ? extras.pollOptions : null;
    if (pollOptions && (pollOptions.length < 2 || pollOptions.length > MAX_POLL_OPTIONS)) {
      return fail(`A poll needs 2 to ${MAX_POLL_OPTIONS} options.`);
    }
    if (pollOptions && !content) return fail('A poll needs a question. Write it in the message.');
    const pollHours = pollOptions ? (extras.pollHours ?? cfg.poll_hours ?? 0) : 0;

    const limit = uploadLimit(guild);
    if (image && image.buffer.length > limit) return fail(`That image is too big for this server. ${imageHelp(limit)}`);

    const blocked = await whyCannotPost(guild, userId);
    if (blocked) return fail(blocked);
    if (await isDuplicate(guild.id, content, cfg.dup_hours)) return fail(DUPLICATE_MESSAGE);

    // Auto-filter: reject right away, or hold the post for a moderator (the author is only told it awaits review).
    let holdReason = null;
    const hit = await checkFilters(guild.id, [content, cw, ...(pollOptions ?? [])], { cfg });
    if (hit) {
      if (cfg.filter_action === 'hold') holdReason = hit.detail;
      else {
        await modLog(guild, {
          title: 'Post blocked by the filter',
          authorId: userId,
          content,
          hasImage: Boolean(image),
          fields: [{ name: 'Matched', value: hit.detail }],
        }).catch(() => {});
        return fail(hit.userMessage);
      }
    }

    // Posting on hold: every other check has passed, so ask before anything is saved.
    const onHold = postingMode(cfg) === 'hold';
    if (onHold && !extras.acceptDelay) return { ok: false, needsConfirm: true, prompt: holdPrompt(cfg), error: 'Posting is paused.' };

    const pending = Boolean(cfg.approval_mode) || holdReason !== null;
    const scheduled = onHold && !pending;
    // A reply goes into a thread when the server uses them, or when it answers something already inside one.
    const target = replyToMessageId ? await db.getConfessionByMessage(guild.id, replyToMessageId) : null;
    const threadRoot = target ? (target.thread_root ?? (cfg.auto_thread ? target.id : null)) : null;
    // "OP" only ever means the author of that post (the thread's post, or the one replied to), and only when asked for.
    const opOf = threadRoot ? await db.getConfession(guild.id, threadRoot) : target;
    const opTag = Boolean(extras.showOp) && opOf?.author_key === userKey(guild.id, userId);

    const created = await db.createConfession(guild.id, userId, content, Boolean(image), {
      tag, pollOptions, pollHours, cw, replyTo: replyToMessageId, pending, scheduled, holdReason, threadRoot, opTag,
    });
    if (image) await db.setConfessionImage(created.id, image.name, image.buffer);
    const row = await db.getConfession(guild.id, created.id);

    if (pending) {
      await modLog(guild, {
        title: holdReason ? 'Submission held by the filter' : 'Submission awaiting approval',
        id: row.id,
        subId: row.sub_id,
        number: null, // assigned when approved
        content,
        authorId: userId,
        hasImage: Boolean(image),
        fields: [...(holdReason ? [{ name: 'Held because', value: holdReason }] : []), ...await logFields(row)],
        components: [approvalRow(row.id)],
        ping: holdReason ? cfg.mod_role_id : null,
      }).catch(() => {});
      return { ok: true, pending: true, id: row.id, subId: row.sub_id, onHold };
    }

    if (scheduled) {
      await modLog(guild, {
        title: 'Submission saved until posting resumes',
        id: row.id,
        subId: row.sub_id,
        number: null,
        content,
        authorId: userId,
        hasImage: Boolean(image),
        controls: true, // moderators can remove it before it goes up
        fields: await logFields(row),
      }).catch(() => {});
      return { ok: true, scheduled: true, id: row.id, subId: row.sub_id, resumesAt: postingResumesAt(cfg) };
    }

    const res = await publish(guild, row);
    if (res.error) {
      await db.discardConfession(guild.id, created.id, created.number);
      return fail(res.error);
    }
    await afterPublish(guild, res.row, res.msg, res.targets);
    return { ok: true, id: created.id, subId: created.subId, number: created.number, url: res.msg.url, alias: res.row.alias };
  });
}

/** Approve a pending submission: it gets the next public number and goes live. */
export function approveSubmission(guild, row, actor) {
  return withLock(guild.id, async () => {
    const fresh = await db.getConfession(guild.id, row.id);
    if (!fresh || fresh.status !== 'pending') return { ok: false, error: 'That submission is not waiting for approval any more.' };
    if (fresh.purged_at) {
      await db.markConfession(guild.id, fresh.id, 'rejected');
      return { ok: false, error: 'Its text was already erased by data retention, so it was rejected instead.' };
    }
    if (await db.getBan(guild.id, fresh.author_key)) {
      await db.markConfession(guild.id, fresh.id, 'rejected');
      return { ok: false, error: 'The author is banned now, so the submission was rejected instead.' };
    }
    const cfg = await db.getGuild(guild.id);
    if (postingMode(cfg) === 'hold') {
      await db.markConfession(guild.id, fresh.id, 'scheduled');
      const resumesAt = postingResumesAt(cfg);
      await dmUser(
        guild.client,
        fresh.author_id,
        notice(`Your submission was approved in ${guild.name}`, `Posting is on hold, so it will go up ${expectedTime(resumesAt)}.`),
      );
      return { ok: true, scheduled: true, resumesAt };
    }
    const number = await db.assignNumber(guild.id, fresh.id);
    const res = await publish(guild, await db.getConfession(guild.id, fresh.id));
    if (res.error) {
      await db.revertAssign(guild.id, fresh.id, number); // stays in the queue; try again
      return { ok: false, error: res.error };
    }
    await afterPublish(guild, res.row, res.msg, res.targets, { title: 'Submission approved', actor });
    await dmUser(
      guild.client,
      fresh.author_id,
      notice(`Your submission was approved in ${guild.name}`, `It is now live as **${anonTitle(number)}**.\n[View it](${res.msg.url})`),
    );
    return { ok: true, number, url: res.msg.url, alias: res.row.alias };
  });
}

/** Reject a pending submission. The author is told, with the reason if the moderator gave one. */
export function rejectSubmission(guild, row, actor, reason) {
  // Under the same lock as approving, so one post cannot be approved and rejected at once.
  return withLock(guild.id, () => rejectNow(guild, row, actor, reason));
}

async function rejectNow(guild, row, actor, reason) {
  const fresh = await db.getConfession(guild.id, row.id);
  if (!fresh || fresh.status !== 'pending') return { ok: false, error: 'That submission is not waiting for approval any more.' };
  await db.markConfession(guild.id, fresh.id, 'rejected');
  const dmed = await dmUser(
    guild.client,
    fresh.author_id,
    notice(
      `Your submission was not approved in ${guild.name}`,
      `A moderator reviewed your submission and it will not be posted.\n**Reason:** ${reason ?? 'No reason given'}`,
    ),
  );
  await modLog(guild, {
    title: 'Submission rejected',
    actor,
    id: fresh.id,
    subId: fresh.sub_id,
    number: null,
    content: fresh.content,
    authorId: fresh.author_id,
    hasImage: Boolean(fresh.has_image),
    reason,
    fields: await logFields(fresh),
  }).catch(() => {});
  return { ok: true, dmed };
}

/** "<time>" for messages about a saved submission. */
export const expectedTime = (ms) => (ms ? `around <t:${Math.ceil(ms / 1000)}:f>` : 'when moderators resume posting');

const RELEASE_GAP_MS = 3000;
const MAX_REFUSALS = 5;
const releasing = new Set(); // servers whose saved submissions are being posted right now

/** A saved submission that can never go up: record it and tell the author why. */
async function dropScheduled(guild, row, why) {
  await db.markConfession(guild.id, row.id, 'rejected');
  await dmUser(guild.client, row.author_id, notice(`Your saved submission was not posted in ${guild.name}`, why));
  await modLog(guild, {
    title: 'Saved submission not posted',
    id: row.id,
    subId: row.sub_id,
    number: null,
    content: row.content,
    authorId: row.author_id,
    hasImage: Boolean(row.has_image),
    reason: why,
    fields: await logFields(row),
  }).catch(() => {});
}

/** Post one saved submission if posting is open. 'next' = carry on with the following one, 'stop' = try again later. */
function releaseOne(guild, id) {
  return withLock(guild.id, async () => {
    if (postingMode(await db.getGuild(guild.id)) !== 'open') return 'stop'; // paused again while we were working
    const row = await db.getConfession(guild.id, id);
    if (!row || row.status !== 'scheduled') return 'next'; // a moderator removed it
    if (row.purged_at) return dropScheduled(guild, row, 'Its text was erased by data retention before it could be posted.').then(() => 'next');
    if (await db.getBan(guild.id, row.author_key)) {
      await dropScheduled(guild, row, 'You can no longer post in this server.');
      return 'next';
    }
    if (row.reply_to) {
      const target = await db.getConfessionByMessage(guild.id, row.reply_to);
      if (target?.status === 'hidden') return 'next'; // under review: wait for the moderators
      if (!target || target.status !== 'posted') {
        await dropScheduled(guild, row, 'The submission you replied to is no longer available.');
        return 'next';
      }
    }
    const image = row.has_image ? await db.getConfessionImage(row.id) : null;
    if (image && image.buffer.length > uploadLimit(guild)) {
      await dropScheduled(guild, row, `Its image is now too big for this server. ${imageHelp(uploadLimit(guild))}`);
      return 'next';
    }

    const number = await db.assignNumber(guild.id, row.id);
    const res = await publish(guild, await db.getConfession(guild.id, row.id));
    if (res.error) {
      await db.revertAssign(guild.id, row.id, number, 'scheduled');
      if (res.gone) {
        await dropScheduled(guild, row, res.error);
        return 'next';
      }
      if (res.refused) {
        // One post Discord will not take must not hold up everything behind it for ever.
        if (await db.addReleaseTry(row.id) >= MAX_REFUSALS) await dropScheduled(guild, row, 'Discord refused to accept it several times.');
        return 'next';
      }
      // Hidden thread: only this one waits. Anything else (channel gone, no permission) affects the rest too.
      return row.thread_root && (await db.getConfession(guild.id, row.thread_root))?.status === 'hidden' ? 'next' : 'stop';
    }
    await afterPublish(guild, res.row, res.msg, res.targets, { title: 'Saved submission posted' });
    // Not awaited: a slow DM must not hold the posting queue.
    dmUser(
      guild.client,
      row.author_id,
      notice(`Your saved submission is up in ${guild.name}`, `It is now live as **${anonTitle(number)}**.\n[View it](${res.msg.url})`),
    ).catch(() => {});
    return 'posted';
  });
}

/**
 * Post the saved submissions of a server, oldest first and a few seconds apart, for as long as posting stays open.
 * Safe to call at any time (every minute, and right after a resume). Returns how many went up.
 */
export async function releaseScheduled(guild, { gapMs = RELEASE_GAP_MS } = {}) {
  if (releasing.has(guild.id)) return 0;
  releasing.add(guild.id);
  let posted = 0;
  try {
    let spaceOut = false; // wait only between two posts, never after the last one
    for (const { id } of await db.listScheduled(guild.id)) {
      if (spaceOut) await new Promise((r) => setTimeout(r, gapMs));
      const outcome = await releaseOne(guild, id);
      if (outcome === 'stop') break;
      spaceOut = outcome === 'posted';
      if (spaceOut) posted++;
    }
  } finally {
    releasing.delete(guild.id);
  }
  return posted;
}

export const resetCounterSafely = (guild, startAt) => withLock(guild.id, async () => await db.resetCounter(guild.id, startAt));

/* ---------- moderation helpers ---------- */

export async function fetchPostMessage(guild, row) {
  if (!row.channel_id || !row.message_id) return null;
  const channel = await openChannel(guild, row.channel_id);
  return channel?.messages.fetch(row.message_id).catch(() => null) ?? null;
}

/** Auto-hide: swap the post for a placeholder (same message, so links keep working) until a moderator decides. */
export async function hideConfessionMessage(guild, row) {
  const msg = await fetchPostMessage(guild, row);
  if (!msg) {
    await db.markConfession(guild.id, row.id, 'deleted'); // someone already removed it by hand
    return false;
  }
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(anonTitle(row.number))
    .setDescription('*This submission was hidden after reports and is waiting for a moderator to review it.*')
    .setImage(`attachment://${PAD_NAME}`);
  await msg.edit({
    embeds: [embed],
    files: [new AttachmentBuilder(padPng(), { name: PAD_NAME })],
    attachments: [],
    components: [],
    allowedMentions: { parse: [] },
  });
  await db.markConfession(guild.id, row.id, 'hidden');
  await removeFeatured(guild, row).catch(() => {});
  return true;
}

/** Put a hidden post back exactly as it was (text, color, image) and clear its reports. */
export async function restoreConfessionMessage(guild, row) {
  if (row.purged_at) return false; // the text is gone (data retention), so there is nothing to put back
  const msg = await fetchPostMessage(guild, row);
  if (!msg) return false;
  const image = row.has_image ? await db.getConfessionImage(row.id) : null;
  await msg.edit({ ...await buildPost(row, image), attachments: [] });
  await db.markConfession(guild.id, row.id, 'posted');
  await db.clearReports(row.id);
  return true;
}

export const deleteConfessionMessage = (guild, target) => withLock(guild.id, async () => removePost(guild, await db.getConfession(guild.id, target.id)));

async function removePost(guild, row) {
  if (row.channel_id && row.message_id) {
    const channel = await openChannel(guild, row.channel_id);
    await channel?.messages.delete(row.message_id).catch(() => {});
  }
  await db.markConfession(guild.id, row.id, 'deleted');
  await closeThread(guild, await db.getConfession(guild.id, row.id));
  await removeFeatured(guild, row).catch(() => {});
}

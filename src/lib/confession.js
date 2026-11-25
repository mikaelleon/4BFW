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
import { COLOR, anonRef, anonTitle, footerLine, prefix, randomSubmissionColor } from './format.js';
import { PAD_NAME, padPng } from './pad.js';
import { imageHelp, uploadLimit } from './image.js';
import { TAGS, getTag, tagText } from './tags.js';

export const MAX_LEN = 2000;
export const OPEN_BUTTON_ID = 'confess:open';
export const GUIDE_BUTTON_ID = 'confess:guide';
export const MODAL_ID = 'confess:modal';
export { prefix };
export const REPLY_BUTTON_ID = 'confess:reply';
export const REPORT_BUTTON_ID = 'confess:report';
export const REACT_PREFIX = 'confess:react'; // "confess:react:up|down|heart"
export const VOTE_PREFIX = 'confess:vote'; // "confess:vote:<option index>"
export const MAX_POLL_OPTIONS = 5;
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
export function confessionEmbed(number, content, color, imageName = PAD_NAME, tag = null) {
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(anonTitle(number))
    .setImage(`attachment://${imageName}`) // the user's image, or the transparent pad when there is none
    .setFooter({ text: footerLine() });
  if (content) embed.setDescription(content);
  const text = tagText(tag);
  if (text) embed.setAuthor({ name: text }); // the topic, shown above the title
  return embed;
}

const reactionButton = (kind, emoji, count) => {
  const button = new ButtonBuilder().setCustomId(`${REACT_PREFIX}:${kind}`).setEmoji(emoji).setStyle(ButtonStyle.Secondary);
  return count > 0 ? button.setLabel(String(count)) : button;
};

/**
 * Buttons under a post: Reply, Report and the 👍 👎 ❤️ counters, plus one button per option for a poll.
 * No confession ID in any custom id: the target is read from the message the button sits on.
 * Rebuilt from the database whenever a count changes.
 */
export function postComponents(row) {
  const counts = db.reactionCounts(row.id);
  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(REPLY_BUTTON_ID).setLabel('Reply').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(REPORT_BUTTON_ID).setLabel('Report').setStyle(ButtonStyle.Secondary),
      reactionButton('up', '👍', counts.up),
      reactionButton('down', '👎', counts.down),
      reactionButton('heart', '❤️', counts.heart),
    ),
  ];
  if (row.is_poll) {
    const votes = db.pollCounts(row.id);
    const options = db.getPollOptions(row.id);
    const total = options.reduce((sum, o) => sum + (votes.get(o.idx) ?? 0), 0);
    rows.push(
      new ActionRowBuilder().addComponents(
        options.map((o) => {
          const n = votes.get(o.idx) ?? 0;
          const share = total ? ` (${Math.round((n / total) * 100)}%)` : '';
          return new ButtonBuilder()
            .setCustomId(`${VOTE_PREFIX}:${o.idx}`)
            .setLabel(`${o.label} · ${n}${share}`.slice(0, 80))
            .setStyle(ButtonStyle.Primary);
        }),
      ),
    );
  }
  return rows;
}

/**
 * Turn "#012" mentions into jump links to that confession (current numbering, newest match),
 * and prepend a "Replying to" line when the Reply button was used.
 */
function linkReferences(guildId, content, replyToMessageId) {
  const targets = new Map(); // confession id -> row, everything this post replies to or mentions
  let linked = 0;
  let body = content.replace(/#(\d{1,6})\b/g, (match, n) => {
    if (linked >= 5) return match;
    const row = db.getLatestPostedByNumber(guildId, Number(n));
    if (!row) return match;
    linked++;
    targets.set(row.id, row);
    return `[${anonRef(row.number)}](${jumpUrl(guildId, row)})`;
  });

  if (replyToMessageId) {
    const target = db.getConfessionByMessage(guildId, replyToMessageId);
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
    if (target.author_id === replierId || notified.has(target.author_id)) continue;
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
            'Got a take too spicy for the group chat? Post it here and let people argue with the idea, not with you.',
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

/** `reply` = { messageId, number } when answering a specific confession. */
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
  if (!reply) {
    // Filling this in turns the submission into a poll: the text above is the question.
    modal.addLabelComponents(
      new LabelBuilder()
        .setLabel('Poll options (optional)')
        .setDescription(`One per line, 2 to ${MAX_POLL_OPTIONS} options. Leave empty for a normal post.`)
        .setTextInputComponent(
          new TextInputBuilder().setCustomId('poll').setStyle(TextInputStyle.Paragraph).setMaxLength(300).setRequired(false),
        ),
    );
  }
  return modal;
}

/* ---------- sticky "button" message at the bottom of the channel ---------- */

async function postSticky(guild) {
  const cfg = db.getGuild(guild.id);
  if (!cfg?.channel_id) return;
  const channel = await guild.channels.fetch(cfg.channel_id).catch(() => null);
  if (!channel) return;
  if (cfg.sticky_id) await channel.messages.delete(cfg.sticky_id).catch(() => {});
  const msg = await channel.send(stickyPayload());
  db.updateGuild(guild.id, { sticky_id: msg.id });
}

export const refreshSticky = (guild) => withLock(guild.id, () => postSticky(guild));

/** Repost the sticky only if it vanished (used on startup). */
export const ensureSticky = (guild) =>
  withLock(guild.id, async () => {
    const cfg = db.getGuild(guild.id);
    if (!cfg?.channel_id) return;
    const channel = await guild.channels.fetch(cfg.channel_id).catch(() => null);
    if (!channel) return;
    const exists = cfg.sticky_id && (await channel.messages.fetch(cfg.sticky_id).catch(() => null));
    if (!exists) await postSticky(guild);
  });

/** Remove the sticky from the (old) channel without reposting. */
export async function removeSticky(guild) {
  const cfg = db.getGuild(guild.id);
  if (!cfg?.channel_id || !cfg.sticky_id) return;
  const channel = await guild.channels.fetch(cfg.channel_id).catch(() => null);
  await channel?.messages.delete(cfg.sticky_id).catch(() => {});
  db.updateGuild(guild.id, { sticky_id: null });
}

/* ---------- submitting ---------- */

/**
 * `image` = { buffer, name } (re-uploaded into the channel).
 * `extras` = { tag, pollOptions }: a topic key, and/or the option labels that make this post a poll.
 */
export function submitConfession(guild, userId, rawContent, replyToMessageId = null, image = null, extras = {}) {
  return withLock(guild.id, async () => {
    const cfg = db.getGuild(guild.id);
    if (!cfg?.channel_id) return fail('Submissions are not set up in this server yet.');

    const content = (rawContent ?? '').trim();
    if (!content && !image) return fail('Write something first.');
    if (content.length > MAX_LEN) return fail(`Too long. Max ${MAX_LEN} characters.`);

    const tag = getTag(extras.tag)?.key ?? null;
    const pollOptions = extras.pollOptions?.length ? extras.pollOptions : null;
    if (pollOptions && (pollOptions.length < 2 || pollOptions.length > MAX_POLL_OPTIONS)) {
      return fail(`A poll needs 2 to ${MAX_POLL_OPTIONS} options.`);
    }
    if (pollOptions && !content) return fail('A poll needs a question. Write it in the message.');

    const limit = uploadLimit(guild);
    if (image && image.buffer.length > limit) return fail(`That image is too big for this server. ${imageHelp(limit)}`);

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return fail('You are not a member of that server.');
    if (db.getBan(guild.id, userId)) return fail('You are banned from posting in this server.');

    const waitMs = db.lastConfessionAt(guild.id, userId) + cfg.cooldown * 1000 - Date.now();
    if (waitMs > 0) return fail(`Slow down. Try again in ${Math.ceil(waitMs / 1000)}s.`);

    const me = guild.members.me ?? (await guild.members.fetchMe());
    const needed = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];
    const usable = (c) => c && c.permissionsFor(me)?.has(needed);
    // A topic can have its own channel (/setup tagchannel). If that one is gone or off-limits, use the main channel.
    const topicId = tag ? db.getTagChannel(guild.id, tag) : null;
    let channel = topicId ? await guild.channels.fetch(topicId).catch(() => null) : null;
    if (!usable(channel)) channel = await guild.channels.fetch(cfg.channel_id).catch(() => null);
    if (!usable(channel)) return fail('I cannot post in the submissions channel right now. Tell an admin.');

    const { id, number } = db.createConfession(guild.id, userId, content, Boolean(image), { tag, pollOptions });
    if (image) db.setConfessionImage(id, image.name, image.buffer);
    let msg;
    const { body, targets } = linkReferences(guild.id, content, replyToMessageId);
    const color = getTag(tag)?.color ?? randomSubmissionColor(guild.id); // tagged posts are colour-coded by topic
    try {
      msg = await channel.send({
        embeds: [confessionEmbed(number, body, color, image ? image.name : PAD_NAME, tag)],
        files: [image ? new AttachmentBuilder(image.buffer, { name: image.name }) : new AttachmentBuilder(padPng(), { name: PAD_NAME })],
        components: postComponents({ id, is_poll: pollOptions ? 1 : 0 }),
        allowedMentions: { parse: [] },
      });
    } catch (err) {
      console.error('Failed to post confession:', err);
      db.discardConfession(guild.id, id, number);
      return fail('Discord refused the post. Try again in a bit.');
    }
    db.setConfessionMessage(guild.id, id, channel.id, msg.id);
    db.setConfessionRendered(id, body, color);

    // Admin-only: the ID appears in the mod log, never in the public channel.
    await modLog(guild, {
      id,
      number,
      url: msg.url,
      content,
      authorId: userId,
      hasImage: Boolean(image),
      controls: true,
      fields: [
        ...(tag ? [{ name: 'Topic', value: tagText(tag), inline: true }] : []),
        ...(pollOptions ? [{ name: 'Poll options', value: pollOptions.map((o) => `• ${o}`).join('\n').slice(0, 1000) }] : []),
      ],
    }).catch(() => {});
    await postSticky(guild).catch((err) => console.error('Failed to refresh sticky:', err));
    // Fire and forget: DMs can be slow or closed, and must not delay the reply to the sender.
    notifyReplies(guild.client, guild, targets, userId, content, msg.url).catch((err) => console.error('Reply notify failed:', err));
    return { ok: true, id, number, url: msg.url };
  });
}

export const resetCounterSafely = (guild, startAt) => withLock(guild.id, async () => db.resetCounter(guild.id, startAt));

/* ---------- moderation helpers ---------- */

async function fetchPostMessage(guild, row) {
  if (!row.channel_id || !row.message_id) return null;
  const channel = await guild.channels.fetch(row.channel_id).catch(() => null);
  return channel?.messages.fetch(row.message_id).catch(() => null) ?? null;
}

/** Auto-hide: swap the post for a placeholder (same message, so links keep working) until a moderator decides. */
export async function hideConfessionMessage(guild, row) {
  const msg = await fetchPostMessage(guild, row);
  if (!msg) {
    db.markConfession(guild.id, row.id, 'deleted'); // someone already removed it by hand
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
  db.markConfession(guild.id, row.id, 'hidden');
  return true;
}

/** Put a hidden post back exactly as it was (text, color, image) and clear its reports. */
export async function restoreConfessionMessage(guild, row) {
  const msg = await fetchPostMessage(guild, row);
  if (!msg) return false;
  const image = row.has_image ? db.getConfessionImage(row.id) : null;
  await msg.edit({
    embeds: [
      confessionEmbed(row.number, row.rendered ?? row.content, row.color ?? randomSubmissionColor(guild.id), image ? image.name : PAD_NAME, row.tag),
    ],
    files: [image ? new AttachmentBuilder(image.buffer, { name: image.name }) : new AttachmentBuilder(padPng(), { name: PAD_NAME })],
    attachments: [],
    components: postComponents(row),
    allowedMentions: { parse: [] },
  });
  db.markConfession(guild.id, row.id, 'posted');
  db.clearReports(row.id);
  return true;
}

export async function deleteConfessionMessage(guild, row) {
  if (row.channel_id && row.message_id) {
    const channel = await guild.channels.fetch(row.channel_id).catch(() => null);
    await channel?.messages.delete(row.message_id).catch(() => {});
  }
  db.markConfession(guild.id, row.id, 'deleted');
}

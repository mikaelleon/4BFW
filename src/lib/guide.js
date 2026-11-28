import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import * as db from '../db.js';
import { COLOR, formatDateTime, prefix } from './format.js';
import { legalUrl } from './legal.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const running = new Set();

export const GUIDE_PREFIX = 'guide';
const PAGES = ['Overview', 'How to Use', 'Rules'];
export const RULES_PAGE = 2; // index of "Rules", where the "Read the rules" button in warning DMs lands

/** A "###" heading with its points quoted underneath. Shared by every list in the guide. */
const block = (title, points) => [`### ${title}`, ...points.map((p) => `> - ${p}`)].join('\n');

function overviewPage({ cfg }) {
  const where = cfg?.channel_id ? `<#${cfg.channel_id}>` : 'the submissions channel';
  const minutes = cfg?.self_delete_minutes ?? 10;
  const url = legalUrl();
  const faqs = [
    ['Is it really anonymous?', 'Your name and picture never show on a post. The bot does record the sender: the server owner can look it up with a PIN, and whoever runs the bot can access its data.'],
    ['What can I post?', 'Confessions, crushes, shoutouts, questions, appreciation, and honest feedback about student life, within the Rules.'],
    ['Where do posts appear?', `In ${where}, unless the server sends a topic to its own channel.`],
    ['Are posts moderated?', cfg?.approval_mode ? 'Yes. A moderator approves each post before it goes up.' : 'Yes. Moderators can remove posts, and rule-breakers may be warned or banned.'],
    ['Can I delete my post?', minutes > 0 ? `Within ${minutes} minute${minutes === 1 ? '' : 's'}: right-click it > Apps > **Delete my submission**.` : 'Ask a moderator.'],
  ];
  return [
    '# OVERVIEW',
    '',
    '**STFW** · *noun* `/ˌɛs-ti-ɛf-ˈdʌbəl-ju/`',
    '> ***S**erver **T**houghts **F**reedom **W**all*; an anonymous outlet for unfiltered thoughts and confessions.',
    "*When you're told to STFU, let the wall do the talking instead.*",
    '',
    '## FAQs',
    ...faqs.map(([question, answer]) => `### ${question}\n> ${answer}`),
    ...(url ? ['', `By posting, you agree to the [Terms of Use](${url}#terms) and [Privacy Policy](${url}#privacy).`] : []),
  ].join('\n');
}

function howToPage({ cfg }) {
  const where = cfg?.channel_id ? `<#${cfg.channel_id}>` : 'the submissions channel';
  const p = prefix();
  const ways = [
    ['Slash command', [
      'Type `/fw` in any channel of the server, or in the bot’s DMs.',
      'Fill in the message field. Optional: `topic`, `image`, or `poll` (`yes/no`, or options split by `|`).',
      'Only you will see the reply.',
    ]],
    ['Button', [
      `Press **Write a Submission** at the bottom of ${where}.`,
      'Type your post in the pop-up. Optional: pick a topic, upload an image, or write poll options (`yes/no`, or one per line).',
    ]],
    ['Direct message', [
      `DM the bot with \`${p} <your message>\`.`,
      'You can attach an image to include it in your post.',
      `Add a topic with \`${p} #memes <message>\`, a content warning with \`${p} cw: label | <message>\`, or a poll with \`${p} poll: Question? | A | B\` (leave out the options for yes/no).`,
      `\`${p} notify off\` stops reply DMs. \`${p} preview on\` shows your post and asks before it goes up.`,
      'If you share more than one server with the bot, it will ask which one to post to. Pick the right server before confirming.',
    ]],
    ['Replying', [
      'Press Reply under any post, or type its number, like `#012`, and it turns into a link.',
      'The author gets a DM saying someone replied to their post.',
      'With reply threads, you keep one alias (like Anon 2) inside a thread, so your replies there can be told apart from others’.',
      'Replying to your own post, you can choose to show as **OP**. It is off unless you pick it.',
      'If posting is paused, you may be asked whether to **Post later**. Nothing is saved unless you agree.',
    ]],
    ['Reacting and voting', [
      'Tap 👍 👎 under a post. One reaction each, tap again to take it back.',
      'On a poll, tap ✅ ❌ or a number to vote. Votes are anonymous.',
      'A poll closes at its end time, or when its author presses Close poll. Results are posted under it.',
      'Posts that collect enough likes may be featured in a special channel.',
    ]],
    ['Reporting', [
      'Press Report under a post that breaks the rules. Reports are anonymous.',
      'Enough reports hide the post until a moderator reviews it.',
    ]],
  ];
  return ['# HOW TO USE IT', ...ways.map(([title, points], i) => block(`${i + 1}. ${title}.`, points))].join('\n');
}

// The server's official rules, as [title, points].
const RULES = [
  [`Freedom of expression`, [
    `Every student is free to share confessions, opinions, and experiences through this bot.`,
    `Speak honestly, but remember that *freedom of speech comes with responsibility.*`,
  ]],
  [`Welcome content`, [
    `Confessions, crushes, shoutouts, thoughts, questions, and appreciation posts are all *encouraged.*`,
    `Honest feedback about student life on campus is also welcome.`,
  ]],
  [`Respect for others`, [
    `Harassment, hate speech, bullying, threats, and discriminatory attacks are __not allowed.__`,
    `This includes naming someone to shame or humiliate them, and it applies equally to students, faculty, administrators, and any other identifiable person.`,
  ]],
  [`Safe content`, [
    `Explicit, illegal, or dangerous content is __not allowed.__`,
    `Anything that puts a person's *safety or privacy* at risk is also prohibited.`,
  ]],
  [`No spam`, [
    `Spam, advertisements, and repeated duplicate posts are __not allowed.__`,
    `Submit your confession *once.*`,
  ]],
  [`Criticizing professors`, [
    `Students may voice opinions, experiences, and concerns about teaching methods, grading, classroom management, academic requirements, and professional conduct.`,
    `Constructive criticism and strongly worded negative feedback are allowed even when a faculty member is identified, as long as the post stays on *relevant academic or professional matters.*`,
  ]],
  [`Serious allegations`, [
    `Serious claims must be presented *responsibly and truthfully.*`,
    `Posts that raise concerns about potentially defamatory statements may be reviewed.`,
  ]],
  [`Moderation`, [
    `Posts are moderated *after* they are posted, based on their content and context.`,
    `Posts that violate these guidelines may be __deleted__, and their authors may be __warned or banned__ from posting without prior notice.`,
  ]],
  [`Responsibility and liability`, [
    `Each user is *solely responsible* for what they submit, and opinions in posts belong to their authors, not the page, its admins, or the developer.`,
    `The developer will not be liable for any conflict, dispute, or damage that arises from submitted content.`,
  ]],
  [`Acceptance of rules`, [
    `Submitting a confession means you have read and agreed to these guidelines.`,
    `The admins may update these rules at any time, so please *review them regularly.*`,
  ]],
];

const rulesPage = () => ['# RULES', ...RULES.map(([title, points], i) => block(`${i + 1}. ${title}.`, points))].join('\n');

const BUILDERS = [overviewPage, howToPage, rulesPage];

/** Navigation buttons, one per page, all in one row (Discord allows five per row). */
function navRows(guildId, page) {
  const buttons = PAGES.map((label, i) =>
    new ButtonBuilder()
      .setCustomId(`${GUIDE_PREFIX}:${guildId}:${i}`)
      .setLabel(label)
      .setStyle(i === page ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(i === page),
  );
  return [new ActionRowBuilder().addComponents(buttons)];
}

/** One page of the guide (overview, how to use, rules) plus its buttons. */
export function guidePayload(guild, page = 0) {
  const index = Number.isInteger(page) && page >= 0 && page < PAGES.length ? page : 0;
  const cfg = db.getGuild(guild.id);
  // No author line or server icon: the guide does not show which server it came from.
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setDescription(BUILDERS[index]({ guild, cfg }))
    .setFooter({ text: `Page ${index + 1} of ${PAGES.length} • brought to you by STFW • ${formatDateTime()}` });
  return { embeds: [embed], components: navRows(guild.id, index) };
}

export async function dmGuide(user, guild) {
  await user.send(guidePayload(guild, 0));
}

const ONLINE_COOLDOWN_MS = 30 * 60_000;

/**
 * Called when the bot starts: DM an "online" embed to every human with the server's online-notice role.
 * Skipped if one went out in the last 30 minutes, so repeated restarts do not spam people.
 */
export async function notifyOnline(guild) {
  const cfg = db.getGuild(guild.id);
  if (!cfg?.online_role_id || !cfg.channel_id) return;
  if (cfg.online_notified_at && Date.now() - cfg.online_notified_at < ONLINE_COOLDOWN_MS) return;
  db.updateGuild(guild.id, { online_notified_at: Date.now() });

  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle('STFW is back online')
    .setDescription(`Submissions are open again in <#${cfg.channel_id}>. Use \`/fw\` or DM me \`${prefix()} <message>\`.`)
    .setFooter({ text: `STFW • ${formatDateTime()}` });

  const members = await guild.members.fetch();
  const targets = members.filter((m) => !m.user.bot && m.roles.cache.has(cfg.online_role_id));
  for (const member of targets.values()) {
    try {
      await member.user.send({ embeds: [embed] });
    } catch (err) {
      if (err?.code === 40003) await sleep(30_000); // opening DMs too fast
    }
    await sleep(1500);
  }
}

export function isBroadcasting(guildId) {
  return running.has(guildId);
}

/**
 * DM the guide to every human member (optionally only those with `role`).
 * Slow on purpose: mass-DMing quickly gets bots rate limited or flagged.
 */
export async function broadcastGuide(guild, role) {
  running.add(guild.id);
  const stats = { sent: 0, failed: 0 };
  try {
    const members = await guild.members.fetch();
    const targets = members.filter((m) => !m.user.bot && (!role || m.roles.cache.has(role.id)));
    for (const member of targets.values()) {
      try {
        await dmGuide(member.user, guild);
        stats.sent++;
      } catch (err) {
        if (err?.code === 40003) await sleep(30_000); // opening DMs too fast
        stats.failed++;
      }
      await sleep(1500);
    }
    stats.total = targets.size;
  } finally {
    running.delete(guild.id);
  }
  return stats;
}

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import * as db from '../db.js';
import { COLOR, formatDateTime, prefix } from './format.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const running = new Set();

export const GUIDE_PREFIX = 'guide';
const PAGES = ['Overview', 'How to Use', 'Rules (P1)', 'Rules (P2)', 'Terms of Use', 'Privacy Policy'];

function overviewPage({ cfg }) {
  const where = cfg?.channel_id ? `<#${cfg.channel_id}>` : 'the submissions channel';
  return [
    '# OVERVIEW',
    '',
    'Got a take too spicy for the group chat? Post it here and let people argue with the idea, not with you.',
    '',
    '> **Completely anonymous**—no one’s gonna know it was you.',
    '',
    '4BFW is an anonymous confessions bot specifically for IT4B students. It lets you share thoughts, confessions, and shoutouts without revealing who you are.',
    '',
    '**Why does this exist?** Many students have something to say but hesitate to say it openly. The bot gives everyone a safe, simple space to speak up.',
    '',
    'Confessions, crushes, shoutouts, questions, and appreciation posts are all welcome. Honest feedback about student life on campus, including constructive criticism of professors, is also allowed within the guidelines.',
    '',
    '**What do we stand for?** The page supports freedom of expression with responsibility and respect. Every post goes through moderation to keep the space safe for everyone.',
    '',
    `**Where do posts appear?** Every submission is posted in ${where}.`,
  ].join('\n');
}

function howToPage({ cfg }) {
  const where = cfg?.channel_id ? `<#${cfg.channel_id}>` : 'the submissions channel';
  const p = prefix();
  // The heading sits inside the quote block so there is no gap between it and its list.
  return [
    '# HOW TO USE IT',
    '',
    '> **1. Slash command:**',
    '> - Type `/fw` in any channel of the server, or in the bot’s DMs.',
    '> - Fill in the message field, and only you will see the reply.',
    '',
    '> **2. Button:**',
    `> - Press **Write a Submission** at the bottom of ${where}.`,
    '> - Type your post in the pop-up and hit submit.',
    '',
    '> **3. Direct message:**',
    `> - DM the bot with \`${p} <your message>\`.`,
    '> - You can attach an image to include it in your post, but this works in **DMs only**.',
    '> - If you share more than one server with the bot, it will ask which one to post to.',
    '> - Pick the right server before confirming.',
    '',
    '> **4. Replying with the button:**',
    '> - Press Reply under any post to respond to it.',
    '> - Or type its number, like `#012`, and it turns into a link',
    '> - The author gets a DM to notify that someone replied to their post',
  ].join('\n');
}

// The server's official rules, as [title, text]. Each page renders them as "1. **Title.** text".
const RULES = [
  [`Freedom of expression`, `Every student is free to share confessions, opinions, and experiences through this bot. Speak honestly, but remember that *freedom of speech comes with responsibility*.`],
  [`Welcome content`, `Confessions, crushes, shoutouts, thoughts, questions, and appreciation posts are all *encouraged*. Honest feedback about student life on campus is also welcome.`],
  [`Respect for others`, `Harassment, hate speech, bullying, threats, and discriminatory attacks are __not allowed__. This includes naming someone to shame or humiliate them, and it applies *equally* to students, faculty, administrators, and any other identifiable person.`],
  [`Safe content`, `Explicit, illegal, or dangerous content is __not allowed__. Anything that puts a person's *safety or privacy* at risk is also prohibited.`],
  [`No spam`, `Spam, advertisements, and repeated duplicate posts are __not allowed__. Submit your confession *once*.`],
  [`Criticizing professors`, `Students may voice opinions, experiences, and concerns about teaching methods, grading, classroom management, academic requirements, and professional conduct. Constructive criticism and strongly worded negative feedback are allowed even when a faculty member is identified, as long as the post stays on *relevant academic or professional matters*.`],
  [`Serious allegations`, `Serious claims must be presented *responsibly and truthfully*. Posts that raise concerns about potentially defamatory statements may be reviewed.`],
  [`Moderation`, `Posts are moderated *after* they are posted, based on their content and context. Posts that violate these guidelines may be __deleted__, and their authors may be __warned or banned__ from posting without prior notice.`],
  [`Responsibility and liability`, `Each user is *solely responsible* for what they submit, and opinions in posts belong to their authors, not the page, its admins, or the developer. The developer will not be liable for any conflict, dispute, or damage that arises from submitted content.`],
  [`Acceptance of rules`, `Submitting a confession means you have read and agreed to these guidelines. The admins may update these rules at any time, so please *review them regularly*.`],
];

const TERMS = [
  [`Acceptance`, `By using this bot, you agree to these terms and the Posting Guidelines. If you disagree, please do not submit anything.`],
  [`Your submissions`, `You are solely responsible for what you post. Only submit content you are willing to stand behind.`],
  [`Prohibited use`, `Do not use the bot to harass, threaten, impersonate, or expose anyone. Spam and attempts to abuse the bot are also not allowed.`],
  [`Moderation`, `Admins may review or remove any submission at their discretion. Repeat violators may be warned or banned from posting without notice.`],
  [`No guarantees`, `The bot is provided "as is," and posts may be delayed or lost due to technical issues. Opinions in confessions belong to their authors, not the developer or the page.`],
  [`Limitation of liability`, `The developer is not liable for any conflict, dispute, or harm arising from submitted content or use of the bot. Continued use means you accept these terms, which may be updated at any time.`],
];

const PRIVACY = [
  [`What we collect`, `The bot receives your submission text, your Discord user ID, and a timestamp. We do not collect your real name or contact details.`],
  [`Anonymity`, `Confessions are posted without your name or profile picture. Avoid including identifying details if you want to stay anonymous.`],
  [`How it's used`, `Your data is used only to deliver, review, and moderate submissions and to prevent abuse. It is never sold or shared with advertisers or third parties.`],
  [`Who can see it`, `Only the developer and designated admins can access sender information. It may be disclosed if required by law or school authorities, or if a post involves serious harm or illegal activity.`],
  [`Retention and removal`, `Records are kept only as long as needed for moderation, then deleted once you leave the server. You may ask an admin to remove your post or delete your stored data if needed.`],
  [`Third parties`, `This bot runs on Discord and is subject to Discord's own Terms and Privacy Policy.`],
];

/** One numbered paragraph per item, blank line between: "1. **Short headline.** The explanation." */
const listPage = (heading, items, start = 1) => () =>
  [`# ${heading}`, '', items.map(([title, text], i) => `${start + i}. **${title}.** ${text}`).join('\n\n')].join('\n');

const BUILDERS = [
  overviewPage,
  howToPage,
  listPage('RULES (P1)', RULES.slice(0, 5), 1),
  listPage('RULES (P2)', RULES.slice(5), 6),
  listPage('TERMS OF USE', TERMS),
  listPage('PRIVACY POLICY', PRIVACY),
];

/** Navigation buttons: one per page, three to a row so six pages split evenly (Discord allows five per row). */
function navRows(guildId, page) {
  const buttons = PAGES.map((label, i) =>
    new ButtonBuilder()
      .setCustomId(`${GUIDE_PREFIX}:${guildId}:${i}`)
      .setLabel(label)
      .setStyle(i === page ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(i === page),
  );
  const rows = [];
  for (let i = 0; i < buttons.length; i += 3) rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 3)));
  return rows;
}

/** One page of the guide (overview, how to use, rules P1/P2, terms of use, privacy policy) plus its buttons. */
export function guidePayload(guild, page = 0) {
  const index = Number.isInteger(page) && page >= 0 && page < PAGES.length ? page : 0;
  const cfg = db.getGuild(guild.id);
  // No author line or server icon: the guide does not show which server it came from.
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setDescription(BUILDERS[index]({ guild, cfg }))
    .setFooter({ text: `Page ${index + 1} of ${PAGES.length} • brought to you by 4BFW • ${formatDateTime()}` });
  return { embeds: [embed], components: navRows(guild.id, index) };
}

export async function dmGuide(user, guild) {
  await user.send(guidePayload(guild, 0));
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

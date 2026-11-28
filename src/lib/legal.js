// The Terms of Use, Privacy Policy and FAQ, served as one web page by the bot's own HTTP server (design: legal-page.js).
// The privacy text describes what the code actually stores: update it when that changes.
import { renderLegalPage } from './legal-page.js';

const UPDATED = 'November 28, 2026';

export const LEGAL_PATH = '/legal';

/**
 * Public address of the page, or null when the bot has no public URL (the guide then leaves the links out).
 * `PUBLIC_URL` wins; Render sets `RENDER_EXTERNAL_URL` by itself.
 */
export function legalUrl() {
  const base = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(base) ? `${base}${LEGAL_PATH}` : null;
}

/** HTTP handler: the page at LEGAL_PATH, a plain "ok" everywhere else (keep-alive pings). */
export function handleHttp(req, res) {
  if (req.url.split('?')[0].replace(/\/$/, '') !== LEGAL_PATH) return res.end('ok');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  return res.end(LEGAL_HTML);
}

const DISCORD = {
  terms: 'https://discord.com/terms',
  privacy: 'https://discord.com/privacy',
  guidelines: 'https://discord.com/guidelines',
};

// `links` turns a phrase of that section's text into a link.
const TERMS = [
  {
    title: 'Using STFW means accepting the rules that govern it.',
    body: 'By interacting with the bot in any way, you agree to be bound by these Terms of Use together with the Privacy Policy and the rules set out in the bot’s guide, and if you do not agree with them, you should not use STFW at all.',
    example: 'Submitting a post, replying to someone else’s, or running one of the bot’s commands each counts as interacting with it.',
  },
  {
    title: 'STFW exists so members can speak without being identified.',
    body: 'The bot posts text and images on a member’s behalf without displaying their name or avatar, while leaving each server free to decide which channels the wall uses, how often members may post, and who moderates it.',
    example: 'One server might open a single channel with a daily posting limit, whereas another might run several channels under much stricter review.',
  },
  {
    title: 'You need to be eligible to use the bot.',
    body: 'You must be permitted to use Discord under its own terms before you can use STFW, and because each server manages its own community, a server may layer additional requirements on top of that baseline.',
    example: 'A server may require that your account be a certain age, or that you have been a member for a set period, before you are allowed to post.',
    links: [['its own terms', DISCORD.terms]],
  },
  {
    title: 'You are responsible for everything you submit.',
    body: 'You must have the right to share any text or images you post, and by submitting them you accept that they may be stored, published to the wall, shown to moderators, and copied to featured channels.',
    example: 'An image you did not create and have no permission to use should not be submitted, and a post that gets featured may end up appearing in more than one place.',
  },
  {
    title: 'The wall may not be used to harm or disrupt others.',
    body: 'Harassment, impersonation, exposing other people, hate speech, and explicit or dangerous content are all prohibited, as are sharing someone’s private information and abusing the bot itself through spam, ban evasion, false reports, or any attempt to disrupt how it works.',
    example: 'Posting a classmate’s real name or contact details, or a screenshot of a private conversation, is a violation even when the post itself is anonymous.',
  },
  {
    title: 'Moderators are responsible for keeping the wall safe.',
    body: 'Moderators may review, hold, hide, or delete posts, and automatic filters or approval requirements may also apply, so anyone who breaks the rules can be warned or banned without advance notice, although both warnings and bans can be appealed.',
    example: 'A post may be held until a moderator approves it, or it may be taken down after publication if a moderator later decides that it breaks the rules.',
  },
  {
    title: 'Anonymity on the wall has real limits.',
    body: 'The bot keeps a record of who sent each post, and what you write can still reveal who you are, while all replies within a single thread share one alias that other readers can link back to the same person.',
    example: 'Mentioning your section, an event that only a few people attended, or a writing style your friends would recognize can be enough for others to guess that a post is yours.',
  },
  {
    title: 'STFW is offered as it is, without promises.',
    body: 'The bot comes with no guarantee that it will always work as expected, and posts may be delayed or lost, while the opinions that appear on the wall belong to the people who wrote them rather than to STFW or its developer.',
    example: 'A post may fail to appear during downtime, and the views expressed in any given post do not represent those of the bot or the server hosting it.',
  },
  {
    title: 'The developer’s liability is limited.',
    body: 'To the fullest extent the law allows, the developer is not responsible for disputes or harm that arise from submissions or from the use of the bot, which means you use STFW at your own risk.',
    example: 'If a post leads to a conflict between members, the developer cannot be held liable for it.',
  },
  {
    title: 'These terms may change over time.',
    body: 'The Terms can be updated at any time, and by continuing to use STFW after an update has been made, you accept the revised version as the one that applies to you.',
    example: 'The “last updated” date at the top of the page shows when the Terms were last changed, so it is worth checking whenever you return.',
  },
];

const PRIVACY = [
  {
    title: 'What we collect',
    points: [
      'Your submissions: text, images, topic, content warning, poll options, and the time sent.',
      'Your Discord user ID, linked to each submission.',
      'Your activity: reactions, poll votes, reports, appeals, and your notification and preview settings.',
      'Moderation records: warnings, bans, and moderator notes.',
      'Direct messages you send to the bot, as needed to handle commands and submissions.',
      'We do not ask for your real name, email address, or phone number.',
    ],
  },
  {
    title: 'How it is used',
    points: [
      'To post and display submissions, send you reply and moderation messages, and prevent abuse.',
      'Your data is never sold or shared with advertisers.',
    ],
  },
  {
    title: 'Who can see it',
    points: [
      'Posts do not show your name or profile picture.',
      'Moderators see the text and images of submissions, but not sender IDs in the mod log.',
      'The server owner can look up the sender of a submission using a private PIN.',
      'Whoever runs the bot has access to its database.',
      'Information may be disclosed if required by law or school authorities, or if a post involves serious harm or illegal activity.',
    ],
  },
  {
    title: 'How it is protected',
    points: [
      'Warnings, bans, notes, votes, reactions, and reports are stored under a keyed hash instead of your Discord ID.',
      'Your Discord ID is still stored with your submissions, and in a few places where the bot needs it to message you.',
      'Hidden image details, such as location and camera data, are removed before an image is stored or posted.',
      'Database backups, when turned on, are encrypted and saved to a private Discord channel.',
      'No system is perfectly secure.',
    ],
  },
  {
    title: 'How long it is kept',
    points: [
      'Each server sets its own retention period. When one is set, the sender ID, text, and images of older submissions are erased from the database.',
      'If no period is set, they are kept until removed.',
      'Moderation records can be kept after that erasure. Leaving a server does not delete your data.',
      'Messages already posted in Discord, and older backups, are not changed by the erasure.',
    ],
  },
  {
    title: 'Your choices',
    points: [
      'You can delete your own post for a short time after posting, if the server allows it.',
      'You can turn off reply notifications.',
      'To have a post removed or your stored data deleted, ask the server’s owner or moderators.',
    ],
  },
  {
    title: 'Third parties',
    points: [
      'The bot runs on Discord, which has its own Terms of Service and Privacy Policy.',
      'It also relies on a hosting provider to run and store its data.',
    ],
    links: [['Terms of Service', DISCORD.terms], ['Privacy Policy', DISCORD.privacy]],
  },
  {
    title: 'Changes',
    points: ['This policy may be updated at any time. The date at the top shows the latest version.'],
  },
];

const CONCERNS = 'Inquiries and concerns';

const FAQ = [
  {
    title: 'Is it really anonymous?',
    body: 'Your name and picture never show on a post. The bot does record the sender: the server owner can look it up with a PIN, and whoever runs the bot can access its data.',
  },
  {
    title: 'What can I post?',
    body: 'Confessions, crushes, shoutouts, questions, appreciation, and honest feedback about student life, within the Rules in the bot’s guide.',
  },
  {
    title: 'Where do posts appear?',
    body: 'In the server’s submissions channel, unless the server sends a topic to its own channel.',
  },
  {
    title: 'Are posts moderated?',
    body: 'Yes. Moderators can remove posts, and rule-breakers may be warned or banned. Some servers approve each post before it goes up.',
  },
  {
    title: 'Can I delete my post?',
    body: 'For a short time after posting, if the server allows it: right-click your post, open Apps, then pick Delete my submission. After that, ask a moderator.',
  },
  {
    title: CONCERNS,
    points: [
      'To report a post, press Report under it.',
      'To contest a warning, use /appeal with the warning ID.',
      'To appeal a ban, send the bot a direct message with its prefix, the word appeal, and your reason (for example: fw appeal, then why).',
      'For anything else, including removing a post or your stored data, message the server’s moderators or owner.',
    ],
  },
];

/** The part of the address that opens "Inquiries and concerns" ("faq-6"). */
export const CONCERNS_ANCHOR = `faq-${FAQ.findIndex((s) => s.title === CONCERNS) + 1}`;

// "Who sees what" at the top of the Privacy Policy. It only restates the policy above: keep the two in step.
const WHO = {
  heading: 'Who sees what',
  post: { title: 'Anonymous #012', text: 'Whoever keeps leaving kind notes on the library tables, thank you. Finals week needed it.' },
  viewers: [
    { name: 'Member', answer: 'Sees the post without your name or picture. What you write or upload can still give you away.' },
    { name: 'Moderator', answer: 'Sees the text and images, but no sender ID in the mod log.' },
  ],
};

const LEGAL_HTML = renderLegalPage({
  updated: UPDATED,
  related: [
    ['Terms of Service', DISCORD.terms],
    ['Privacy Policy', DISCORD.privacy],
    ['Community Guidelines', DISCORD.guidelines],
  ],
  docs: [
    { id: 'terms', name: 'Terms of Use', sections: TERMS },
    { id: 'privacy', name: 'Privacy Policy', sections: PRIVACY, who: WHO },
    { id: 'faq', name: 'FAQ', sections: FAQ },
  ],
});

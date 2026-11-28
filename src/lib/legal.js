// The Terms of Use and Privacy Policy, served as one web page by the bot's own HTTP server.
// The privacy text describes what the code actually stores: update it when that changes.
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

// Each section is [title, points].
const TERMS = [
  ['Acceptance', [
    'By using STFW, you agree to these Terms of Use, the Privacy Policy, and the Rules shown in the bot’s guide.',
    'If you disagree, do not submit, reply, react, vote, or report.',
  ]],
  ['What STFW does', [
    'STFW lets members of a Discord server post messages, images, polls, and replies without their name or profile picture shown on the post.',
    'Each server decides its own channels, limits, and moderators.',
  ]],
  ['Eligibility', [
    'You must be allowed to use Discord under Discord’s Terms of Service, including its minimum age.',
    'A server may require a minimum account age or time in the server before you can post.',
  ]],
  ['Your submissions', [
    'You are solely responsible for what you post. Only submit content you are willing to stand behind.',
    'You must have the right to share any text or image you submit.',
    'By submitting, you allow the bot to store it, post it in the server, show it to moderators, and copy it to a featured or highlights channel.',
  ]],
  ['Prohibited use', [
    'Do not use the bot to harass, bully, threaten, impersonate, or expose anyone.',
    'Do not post hate speech, explicit, illegal, or dangerous content, or other people’s private information.',
    'Do not spam, advertise, evade a ban, file false reports, or try to abuse or disrupt the bot.',
  ]],
  ['Moderation', [
    'Moderators may review, hold, hide, or delete any submission at their discretion.',
    'Posts may be checked by an automatic filter, and a server may require approval before a post goes up.',
    'Rule-breakers may be warned or banned from posting without prior notice.',
    'You can contest a warning with /appeal, or a ban by messaging the bot with the word appeal after its prefix.',
  ]],
  ['Anonymity has limits', [
    'Your post hides your identity from other members, but the bot records who sent it.',
    'What you write or upload can still identify you.',
    'Inside a reply thread you keep one alias, so your replies in that thread can be linked to each other.',
  ]],
  ['No guarantees', [
    'The bot is provided “as is,” and posts may be delayed or lost because of technical issues.',
    'Opinions in submissions belong to their authors, not the developer, the server, or its moderators.',
  ]],
  ['Limitation of liability', [
    'To the extent the law allows, the developer is not liable for any conflict, dispute, damage, or harm arising from submitted content or use of the bot.',
  ]],
  ['Changes', [
    'These terms may be updated at any time. Continued use means you accept the updated terms.',
  ]],
];

const PRIVACY = [
  ['What we collect', [
    'Your submissions: text, images, topic, content warning, poll options, and the time sent.',
    'Your Discord user ID, linked to each submission.',
    'Your activity: reactions, poll votes, reports, appeals, and your notification and preview settings.',
    'Moderation records: warnings, bans, and moderator notes.',
    'Direct messages you send to the bot, as needed to handle commands and submissions.',
    'We do not ask for your real name, email address, or phone number.',
  ]],
  ['How it is used', [
    'To post and display submissions, send you reply and moderation messages, and prevent abuse.',
    'Your data is never sold or shared with advertisers.',
  ]],
  ['Who can see it', [
    'Posts do not show your name or profile picture.',
    'Moderators see the text and images of submissions, but not sender IDs in the mod log.',
    'The server owner can look up the sender of a submission using a private PIN.',
    'Whoever runs the bot has access to its database.',
    'Information may be disclosed if required by law or school authorities, or if a post involves serious harm or illegal activity.',
  ]],
  ['How it is protected', [
    'Warnings, bans, notes, votes, reactions, and reports are stored under a keyed hash instead of your Discord ID.',
    'Your Discord ID is still stored with your submissions, and in a few places where the bot needs it to message you.',
    'Hidden image details, such as location and camera data, are removed before an image is stored or posted.',
    'Database backups, when turned on, are encrypted and saved to a private Discord channel.',
    'No system is perfectly secure.',
  ]],
  ['How long it is kept', [
    'Each server sets its own retention period. When one is set, the sender ID, text, and images of older submissions are erased from the database.',
    'If no period is set, they are kept until removed.',
    'Moderation records can be kept after that erasure. Leaving a server does not delete your data.',
    'Messages already posted in Discord, and older backups, are not changed by the erasure.',
  ]],
  ['Your choices', [
    'You can delete your own post for a short time after posting, if the server allows it.',
    'You can turn off reply notifications.',
    'To have a post removed or your stored data deleted, ask the server’s owner or moderators.',
  ]],
  ['Third parties', [
    'The bot runs on Discord, which has its own Terms of Service and Privacy Policy.',
    'It also relies on a hosting provider to run and store its data.',
  ]],
  ['Changes', [
    'This policy may be updated at any time. The date at the top shows the latest version.',
  ]],
];

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const section = (id, heading, items) =>
  [
    `<section id="${id}">`,
    `<h2>${heading}</h2>`,
    ...items.map(
      ([title, points], i) =>
        `<h3>${i + 1}. ${escapeHtml(title)}</h3>\n<ul>${points.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>`,
    ),
    '</section>',
  ].join('\n');

const LEGAL_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>STFW · Terms of Use and Privacy Policy</title>
<style>
  :root { color-scheme: light dark; --accent: #821b33; }
  @media (prefers-color-scheme: dark) { :root { --accent: #f0a03c; } }
  body { max-width: 42rem; margin: 0 auto; padding: 2rem 1rem 4rem; font: 1rem/1.6 system-ui, sans-serif; }
  h1, h2, h3 { line-height: 1.25; }
  h2 { margin-top: 3rem; padding-bottom: .4rem; border-bottom: 2px solid var(--accent); }
  h3 { margin: 1.75rem 0 .25rem; font-size: 1.05rem; }
  ul { margin: 0; padding-left: 1.25rem; }
  a { color: var(--accent); }
</style>
</head>
<body>
<h1>STFW · Server Thoughts Freedom Wall</h1>
<p>Last updated: ${UPDATED}</p>
<nav><a href="#terms">Terms of Use</a> · <a href="#privacy">Privacy Policy</a></nav>
${section('terms', 'Terms of Use', TERMS)}
${section('privacy', 'Privacy Policy', PRIVACY)}
</body>
</html>
`;

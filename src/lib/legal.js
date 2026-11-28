// The Home page, Terms of Use, Privacy Policy and General FAQs, served by the bot's own HTTP server (design: legal-page.js).
// They are one document with a tab each: "/", "/terms", "/privacy" and "/faq" all send it, and the browser shows the tab.
// The privacy text describes what the code actually stores: update it when that changes.
import { prefix } from './format.js';
import { renderLegalPage } from './legal-page.js';
import { latestUpdates, repoUrl } from './updates.js';

const UPDATED = 'November 29, 2026';

export const LEGAL_PATH = '/legal';

/**
 * Public address of the page, or null when the bot has no public URL (the guide then leaves the links out).
 * `PUBLIC_URL` wins; Render sets `RENDER_EXTERNAL_URL` by itself.
 */
export function legalUrl() {
  const base = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(base) ? `${base}${LEGAL_PATH}` : null;
}

// LEGAL_PATH stays for the links already posted in Discord ("/legal#faq-6"): the browser moves them to the new address.
const PAGES = new Set(['', LEGAL_PATH, '/terms', '/privacy', '/faq']);

let statusSource = null;

/** The bot hands over its uptime here. Without it (the pages served on their own) the status shows as unavailable. */
export function setStatusSource(source) {
  statusSource = source;
}

/** The home page's live data: { bot, updates }, each null when it cannot be read. */
async function sendStatus(res) {
  const body = JSON.stringify({ bot: statusSource?.() ?? null, updates: await latestUpdates() });
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

/** HTTP handler: the web page at the addresses in PAGES, its live data, and a plain "ok" everywhere else (keep-alive pings). */
export function handleHttp(req, res) {
  const path = req.url.split('?')[0].replace(/\/$/, '');
  if (path === '/status.json') {
    return sendStatus(res).catch((err) => {
      console.error('Status request failed:', err);
      res.destroy();
    });
  }
  if (!PAGES.has(path)) return res.end('ok');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  return res.end(PAGE_HTML);
}

const DISCORD = {
  terms: 'https://discord.com/terms',
  privacy: 'https://discord.com/privacy',
  guidelines: 'https://discord.com/guidelines',
};

// `links` turns a phrase of that section's text into a link.
// The text of these three mirrors docs/terms-privacy-draft.md: keep them in step.
const TERMS = [
  {
    title: 'Accepting these terms',
    body: [
      'STFW, short for Server Thoughts Freedom Wall, is a Discord bot developed by EON Development that publishes submissions without showing who wrote them. By interacting with it in any way, such as sending a submission or pressing a button under a post, __you agree to these Terms of Use__. Your agreement also covers the Privacy Policy and the rules in the bot’s guide. If you do not agree with any of them, please do not use STFW.',
    ],
    example: 'Sending a submission, replying to a post, or running one of the bot’s commands each counts as interacting with STFW.',
    links: [['Privacy Policy', '/privacy']],
  },
  {
    title: 'Who may use STFW',
    body: [
      'You must be allowed to use Discord under its own Terms of Service, which includes meeting the minimum age that Discord requires in your country. Each server manages its own community and may add conditions of its own, for instance a minimum account age, a waiting period after joining, a pause between posts, or a daily posting limit.',
    ],
    example: 'One server may require an account of a certain age, while another limits how many posts you can send in a day.',
    links: [['Terms of Service', DISCORD.terms]],
  },
  {
    title: 'What the bot does',
    body: [
      `The bot publishes your text and images to a channel chosen by the server, displaying a public number in place of your name and profile picture. You can submit with the \`/fw\` command or the **Write a Submission** button. Direct messages to the bot also work when they start with \`${prefix()}\` or your server's own prefix. If you share more than one server with the bot, it asks where a direct message should go.`,
      'A submission may include a single image, a topic, a content warning, or a poll offering a yes/no question or as many as five choices. Text is optional when an image is attached. Depending on how a server has set it up, you may also be able to reply to posts, react to them, vote in polls, report content, or appeal a moderator’s decision. Servers decide which of these features are switched on and may change their settings or pause submissions whenever they see fit. A submission that is held during a pause is saved only if you agree to have it posted later.',
    ],
    example: 'One server might open a single channel for the wall, whereas another might send certain topics to channels of their own.',
  },
  {
    title: 'Your submissions',
    body: [
      'You are __solely responsible for everything you submit__. Do not send text or images unless you have the right to share them. By submitting something, you permit STFW to store it and to display it on the wall of the server you chose. That permission extends to showing it to moderators and to copying it into a highlight or featured channel when the server uses one. You keep whatever ownership you already have in your work.',
      'Opinions in a submission belong to its author. They do not represent the views of STFW or EON Development, and they should not be read as the position of the server or its administrators.',
    ],
    example: 'A picture you did not create and have no permission to share should not be submitted.',
  },
  {
    title: 'What is welcome',
    body: [
      'Confessions, crushes, shoutouts, questions, appreciation posts, and honest feedback about community life are welcome. You may criticize how someone in a position of responsibility carries out that role, including in strong language and when the person is identified, as long as the post stays on matters relevant to the role. Serious allegations must be presented truthfully and responsibly. Posts that could be defamatory may be reviewed.',
    ],
  },
  {
    title: 'What is prohibited',
    body: [
      'The following conduct is not allowed on the wall:',
    ],
    points: [
      'Harassing or bullying another person.',
      'Using threatening or discriminatory language, including hate speech.',
      'Naming someone in order to shame or humiliate them, whether that person is an ordinary member or someone who holds a position of responsibility.',
      'Posting material that is explicit or illegal.',
      'Sharing anything dangerous or likely to put a person’s safety or privacy at risk, such as contact details published without permission.',
      'Impersonating another person.',
      'Sending advertising or other spam, which includes submitting the same confession more than once.',
      'Abusing the bot, for example by filing false reports or trying to get around a ban.',
      'Attempting to disrupt how the bot works or to gain access to data that is not yours.',
    ],
    after: [
      'Your use of STFW must also comply with Discord’s Terms of Service and Community Guidelines. The rules in the bot’s guide, which you can open with `/guide`, apply alongside this list.',
    ],
    example: 'Publishing a person’s home address or a screenshot of a private conversation is a violation even though the post shows no name.',
    links: [['Terms of Service', DISCORD.terms], ['Community Guidelines', DISCORD.guidelines]],
  },
  {
    title: 'Moderation and enforcement',
    body: [
      'Although STFW discourages prohibited content, __responsibility for enforcing these rules rests with the moderators of each server__. The bot provides tools such as filters, approval queues, reports, warnings, and bans, and the moderators decide how those tools are used. Most posts are reviewed after they appear, while some servers approve each one beforehand. An automatic filter may also reject a submission or hold it for review. A post that collects enough reports is hidden until a moderator restores or deletes it.',
      'Moderators may take a submission out of view, either temporarily or permanently, and they may warn or ban its author without advance notice. Reaching a server’s warning limit (three by default) results in an automatic ban. EON Development does not review submissions in advance and does not promise that every violation will be noticed or acted upon.',
      'You can delete your own submission for ten minutes after it goes up, unless the server has changed that period or turned the option off. Open the menu on the post, choose **Apps**, and then select **Delete my submission**. Later removals have to be requested from a moderator. Deletion is also subject to the retention rules in the Privacy Policy.',
    ],
    example: 'A post may wait for approval before it appears, or it may be taken down later if a moderator decides that it breaks the rules.',
    links: [['Privacy Policy', '/privacy']],
  },
  {
    title: 'Appeals',
    body: [
      `You may contest a warning with the \`/appeal\` command and the warning ID shown in the notice you received. A ban can be appealed by sending the bot a direct message beginning with \`${prefix()} appeal\`, or the equivalent under your server's prefix, followed by your explanation. The moderators of that server decide the outcome. A denied ban appeal may be sent again after one week. Removing a post without a warning has no appeal command, so questions about it should go to a moderator.`,
    ],
  },
  {
    title: 'Anonymity on the wall',
    body: [
      'Submissions are published without your name or profile picture, and the moderation log does not display sender IDs. STFW keeps certain records so that servers can apply their rules and respond to serious concerns. The Privacy Policy explains what those records contain and who may access them. Please take care with personal details in anything you write or upload.',
    ],
    example: 'Your home address and the details of a private gathering are personal information worth leaving out.',
    links: [['Privacy Policy', '/privacy']],
  },
  {
    title: 'Availability',
    body: [
      'STFW is provided as it is and as it is available. EON Development does not guarantee that the bot will run without interruption or error. Posts and messages may be delayed or lost. EON Development may also change features or discontinue the service.',
    ],
    example: 'A submission may fail to appear while the bot is offline.',
  },
  {
    title: 'Liability',
    body: [
      '__To the fullest extent the law allows, EON Development is not responsible or liable for anything that happens after something is posted__, including any dispute or harm that arises from a submission. The same limit applies to loss caused by downtime and to anything done by moderators or other users. You use STFW at your own risk. Nothing in these terms removes a right or a liability that the law does not permit anyone to exclude.',
    ],
    example: 'If a post leads to a conflict between members, EON Development cannot be held liable for it.',
  },
  {
    title: 'Server owners and administrators',
    body: [
      'If you add STFW to a server, you are responsible for how it is used there. This includes appointing suitable moderators, keeping the moderation log and any backup channel restricted to trusted people, and telling members about additional rules that apply to them. Information that identifies a sender may be looked up only for the reasons set out in the Privacy Policy, and it must not be used to expose or retaliate against anyone.',
    ],
    links: [['Privacy Policy', '/privacy']],
  },
  {
    title: 'Changes and governing law',
    body: [
      'These terms may be updated at any time, and the date at the top of the published page shows the latest version. Continuing to use STFW after an update means that you accept it. These terms are governed by the laws of the Republic of the Philippines.',
    ],
    example: 'The “last updated” date shows when the Terms were last changed, so check it whenever you return.',
  },
  {
    title: 'Contact',
    body: [
      'For a post, a warning, or a request about your data, contact the owner or moderators of your server.',
    ],
  },
];

const PRIVACY = [
  {
    title: 'Scope',
    body: [
      'This policy explains what STFW collects, why it collects it, who can see it, and how long it stays. It covers the bot and its web page, both of which are developed by EON Development. Discord handles your account and messages under its own Privacy Policy, which this document does not replace.',
    ],
    links: [['its own Privacy Policy', DISCORD.privacy]],
  },
  {
    title: 'Information you provide',
    points: [
      '__Submissions and replies.__ Their text and images, together with every option you choose for them, including the topic, any content warning, poll choices, and whether you appear as the original poster in a reply.',
      '__Appeals and reports.__ The explanation you write when contesting a warning or ban, and the reason you give when reporting a post.',
      '__Direct messages.__ Messages you send the bot are read so that it can carry out commands and accept submissions. If it was offline when you wrote, it reads what it missed after restarting and ignores anything older than 24 hours.',
      '__Settings.__ Whether you have turned off reply notifications or turned on post previews.',
    ],
    after: [
      'STFW does not ask for your real name or for contact details such as an email address. Anything of that kind that you type into a submission is stored as part of it.',
    ],
  },
  {
    title: 'Information created or received when you use the bot',
    points: [
      'Your Discord user ID, linked to each submission.',
      'Identifiers showing where a message was posted, together with the time it was sent.',
      'Reactions and poll votes.',
      'Moderation records connected to you, such as warnings or bans.',
      'The alias assigned to you inside a reply thread.',
      'A record of the last direct message the bot handled from you, which prevents anything from being processed twice.',
    ],
    after: [
      'The bot also checks information that Discord makes available, such as your roles and how long you have had your account or belonged to a server, in order to apply that server’s settings.',
      'A submission that is waiting for you to confirm a preview or a later posting time is held in temporary memory for up to ten minutes. It is discarded if you cancel or do not answer.',
    ],
  },
  {
    title: 'How the information is used',
    body: [
      'STFW uses this information to publish submissions under each server’s limits and filters, and to send you notices about replies or moderation. It also helps prevent abuse and resolve appeals, and it is copied into backups where the bot’s operator has turned them on. __Your data is never sold or shared with advertisers.__',
    ],
  },
  {
    title: 'Who can see it',
    points: [
      '__Members__ see published posts without your name or profile picture. Replies in the same thread share one alias, so they can be recognized as coming from one person.',
      '__Moderators__ see what each submission contains, as well as whatever is written in reports and appeals. The moderation log does not show sender IDs, and reports do not show who filed them. Moderators can, however, view an author’s other posts and moderation records through any one of that author’s submissions.',
      '__Sender records__ are kept out of public view and out of the moderation log. Access is limited to authorized people and is subject to this policy.',
    ],
    after: [
      'Authorized administrators of the server and the bot may identify a sender __only when necessary__, for example in cases involving cyberbullying or online harassment, and likewise where someone is threatened or seriously harmed. Such handling is subject to Philippine law, including the Cybercrime Prevention Act of 2012 (Republic Act No. 10175) and the Safe Spaces Act (Republic Act No. 11313). Information may also be disclosed when the law or the relevant authorities require it, or when a post involves serious harm or illegal activity.',
    ],
  },
  {
    title: 'Protection',
    body: [
      'Warnings, bans, moderator notes, reactions, poll votes, reports, and thread aliases are filed under a keyed hash, which is a scrambled code that stands in for your Discord ID. A person who holds both the database and the secret key could still match a code to an account. __Your actual Discord ID remains stored__ with your submissions and in places where the bot needs it, including warning appeals, your settings, the direct message record, and notices about timed bans.',
      'Hidden details inside images, such as location and camera data, are removed before an image is stored or posted. Backups, when turned on, are encrypted and saved to a private Discord channel. The database is closed to its provider’s public web interface. No system is perfectly secure, and STFW cannot guarantee that information will never be accessed without permission.',
    ],
  },
  {
    title: 'Retention and deletion',
    body: [
      'Each server chooses its own retention period. Where one is set, the contents of a submission older than that period are erased from the database, along with its sender ID. Where none is set, these details remain until somebody removes them. A server may separately delete stored images of older submissions to save space, even when it has no retention period.',
      '__Erasure is not complete removal.__ The following can remain afterward:',
    ],
    points: [
      'The submission’s numbers, status, time, topic, content warning, poll choices, and keyed code.',
      'Moderation records, such as warnings.',
      'Information that contains your Discord ID, including warning appeals, your settings, the direct message record, and open timed-ban notices.',
      'Open ban appeals.',
      'Messages already posted in Discord, including entries in the moderation log.',
      'Older backups, until newer ones replace them. The bot keeps the ten most recent.',
    ],
    after: [
      'Deleting your own post, or having a moderator delete it, removes it from the wall but does not immediately erase its database record. Leaving a server or removing the bot does not delete stored data either.',
    ],
  },
  {
    title: 'Your choices and rights',
    body: [
      'You may delete your own post for a limited time, ten minutes by default, if the server allows it, and you may turn reply notifications off. To have a post removed or your stored data corrected or erased, ask the server’s owner or moderators, who may need help from whoever operates the database. You may also have rights under the Data Privacy Act of 2012 (Republic Act No. 10173), such as access to your information or objection to its processing. Some records may be kept where the law permits it, for example while a complaint is being investigated.',
    ],
  },
  {
    title: 'Service providers and the web page',
    body: [
      'STFW runs on Discord and relies on a hosting provider to operate the bot as well as Supabase to store its database. These providers process information under their own terms, possibly in a country other than yours. The web page uses no outside trackers. It saves your display preferences in your own browser, and the hosting provider may keep ordinary technical logs of visits.',
    ],
  },
  {
    title: 'Changes and contact',
    body: [
      'This policy may be updated at any time, and the date at the top of the published page shows the latest version. Questions about privacy may be directed to your server’s owner.',
    ],
  },
];

const CONCERNS = 'Where do I send inquiries and concerns?';

const FAQ = [
  {
    title: 'Is the wall really anonymous?',
    body: [
      'Your posts appear under a number, without your name or profile picture. STFW does keep records linked to each submission, and the Privacy Policy explains who may access them. Please take care with personal details in anything you write or upload.',
    ],
    links: [['Privacy Policy', '/privacy']],
  },
  {
    title: 'How do I send a submission?',
    body: [
      `Type \`/fw\` in any channel, or press **Write a Submission** in the submissions channel. A direct message to the bot starting with \`${prefix()}\` also works, although your server may use another prefix. You can add a single image, a topic, a content warning, or a poll. Your server may limit how often you post or who is eligible.`,
    ],
  },
  {
    title: 'What am I allowed to post?',
    body: [
      'Confessions, crushes, shoutouts, questions, appreciation posts, and honest feedback about community life are welcome, including criticism of how someone carries out a position of responsibility. Harassment and hateful or threatening language are prohibited, as is shaming anyone by name. Explicit or illegal material is also banned, along with anything that endangers a person’s safety or privacy. You may not impersonate people, and spamming or otherwise abusing the bot is not allowed.',
      '__Server moderators are responsible for enforcing these rules.__ To the fullest extent the law allows, EON Development is not responsible or liable for anything that happens after something is posted.',
    ],
  },
  {
    title: 'How are posts moderated, and can I appeal?',
    body: [
      `Moderators may remove posts and may warn or ban their authors without advance notice. Some servers also filter or approve submissions before they appear. Press **Report** under a post that breaks the rules. To contest a warning, use \`/appeal\` with its warning ID, and to appeal a ban, send the bot \`${prefix()} appeal\` followed by your explanation. A removal without a warning can only be raised with a moderator.`,
      'Moderators can review an author’s other posts and moderation records through any of that author’s submissions, without seeing the account behind them. Authorized administrators may identify a sender only when necessary, as the Privacy Policy explains with reference to Republic Act No. 10175 and Republic Act No. 11313.',
    ],
    links: [['Privacy Policy', '/privacy']],
  },
  {
    title: 'Can I delete my post or my information?',
    body: [
      'You can delete your own post for ten minutes by default, if your server allows it, through **Apps** and then **Delete my submission**. Afterward, ask a moderator or the server owner. Deleting a post or leaving the server __does not immediately erase stored records__. Servers set how long submissions are kept and may separately delete older images to save space. Some records, including ones containing your Discord ID, can remain after erasure.',
    ],
  },
  {
    title: CONCERNS,
    body: [
      'Contact your server’s owner or moderators about anything concerning your posts, warnings you have received, your stored data, or other moderation matters. Use **Report** under a post that breaks the rules.',
    ],
  },
];

/** The part of the address that opens the inquiries and concerns question ("faq-6"). */
export const CONCERNS_ANCHOR = `faq-${FAQ.findIndex((s) => s.title === CONCERNS) + 1}`;

// "Who sees what", a card inside the Privacy Policy. It only restates the policy above: keep the two in step.
const WHO = {
  heading: 'Who sees what',
  after: 5, // "Who can see it"
  post: { title: 'Anonymous #012', text: 'Whoever keeps leaving kind notes in the welcome channel, thank you. This week needed it.' },
  viewers: [
    { name: 'Member', answer: 'Sees the post without your name or picture. What you write or upload can still give you away.' },
    { name: 'Moderator', answer: 'Sees the text and images, but no sender ID in the mod log.' },
  ],
};

// The invite link, with the permissions listed in the README. Without a CLIENT_ID the page leaves the button out.
const CLIENT_ID = (process.env.CLIENT_ID || '').trim();
const INVITE_URL = /^\d+$/.test(CLIENT_ID)
  ? `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&scope=bot%20applications.commands&permissions=309237763072`
  : null;

// Home only restates the guide and the FAQ: keep them in step. `links` starting with "/" open a tab of this page.
// In page text, `backticks` mark a command and **stars** the name of a button.
// __Underscores__ mark an important statement. A `body` given as a list becomes one paragraph per item.
const HOME = [
  {
    title: 'Post with a slash command',
    icon: 'terminal',
    copy: '/fw',
    body: 'Type `/fw` in any channel of the server, or in the bot’s DMs, and only you will see the reply.',
  },
  {
    title: 'Post with the button',
    icon: 'pointer',
    tryIt: 'Try the preview',
    body: 'Press **Write a Submission** at the bottom of the submissions channel, then type your post in the pop-up.',
  },
  {
    title: 'Post by direct message',
    icon: 'message',
    copy: `${prefix()} `,
    body: `DM the bot with \`${prefix()}\` followed by your message, and attach an image if you want it included.`,
  },
  {
    title: 'Read this before you post',
    icon: 'book',
    body: 'The General FAQs cover anonymity, and posting means you accept the Terms of Use and the Privacy Policy.',
    links: [['Terms of Use', '/terms'], ['Privacy Policy', '/privacy']],
  },
];

const PAGE_HTML = renderLegalPage({
  updated: UPDATED,
  related: [
    ['Terms of Service', DISCORD.terms],
    ['Privacy Policy', DISCORD.privacy],
    ['Community Guidelines', DISCORD.guidelines],
  ],
  // The home page's buttons: the first is the filled one.
  actions: [...(INVITE_URL ? [['Invite to Discord Server', INVITE_URL]] : []), ['Read the General FAQs', '/faq']],
  sample: WHO.post,
  live: { url: '/status.json', history: repoUrl },
  docs: [
    { id: 'home', name: 'Home', sections: HOME },
    { id: 'terms', name: 'Terms of Use', sections: TERMS, dated: true },
    { id: 'privacy', name: 'Privacy Policy', sections: PRIVACY, who: WHO, dated: true },
    { id: 'faq', name: 'General FAQs', short: 'FAQs', sections: FAQ },
  ],
});

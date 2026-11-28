import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  Partials,
  StringSelectMenuBuilder,
} from 'discord.js';
import * as db from './db.js';
import { commands } from './commands/index.js';
import { candidateGuilds, serverAutocomplete } from './lib/context.js';
import {
  MAX_LEN,
  MODAL_ID,
  GUIDE_BUTTON_ID,
  OPEN_BUTTON_ID,
  REPLY_BUTTON_ID,
  REACT_PREFIX,
  REPORT_BUTTON_ID,
  VOTE_PREFIX,
  APPROVAL_PREFIX,
  CLOSE_POLL_ID,
  LIKERT,
  OPTIONS_BUTTON_PREFIX,
  OPTIONS_MODAL_PREFIX,
  YES_NO,
  confessModal,
  ensureSticky,
  optionsModal,
  whyCannotPost,
} from './lib/confession.js';
import { PIN_DISMISS_ID, PIN_MODAL_PREFIX, handlePinDismiss, handlePinModal } from './lib/owner-pin.js';
import { prefix } from './lib/format.js';
import { handleHttp, legalUrl, setStatusSource } from './lib/legal.js';
import { withKeyLock } from './lib/locks.js';
import { BUSY_MESSAGE, claimUpload, downloadImage, imageHelp, pickImage, prepareImage, uploadLimit } from './lib/image.js';
import { holdsImages, keep } from './lib/held.js';
import { closedNotice } from './lib/hours.js';
import { userKey } from './lib/identity.js';
import { CONTROL_PREFIX } from './lib/controls-row.js';
import { REASON_PREFIX, handleControlButton, handleReasonModal } from './lib/controls.js';
import { handleClosePollButton, handleReactionButton, handleVoteButton, parsePollOptions } from './lib/engagement.js';
import { APPROVAL_REASON_PREFIX, handleApprovalButton, handleApprovalModal } from './lib/approvals.js';
import { DRAFT_PREFIX, handleDraftButton, resultText, submitOrPreview } from './lib/drafts.js';
import { dmTagList, parseDmPost } from './lib/dm-syntax.js';
import { REPORT_MODAL_PREFIX, handleReportButton, handleReportModal } from './lib/reports.js';
import { startScheduler } from './lib/scheduler.js';
import { startBackups } from './lib/backup.js';
import { startUptime, uptimeStatus } from './lib/uptime.js';
import { GUIDE_PREFIX, RULES_PAGE, dmGuide, guidePayload, notifyOnline } from './lib/guide.js';
import {
  APPEAL_MODAL_PREFIX,
  APPEAL_PICK_PREFIX,
  APPEAL_PREFIX,
  handleAppealButton,
  handleAppealFormButton,
  handleAppealModal,
  handleAppealPick,
} from './lib/appeals.js';
import { BAN_APPEAL_PREFIX, appealUsage, bannedGuildsOf, handleBanAppealButton, submitBanAppeal } from './lib/ban-appeals.js';
import { APPEAL_FORM_PREFIX, RULES_PREFIX } from './lib/notices.js';
import { CLEARWARN_PREFIX, handleClearWarnComponent } from './lib/clear-warnings.js';

// Keep-alive endpoint for hosts that need an open port (Render + UptimeRobot). Also serves the Terms and Privacy page.
http.createServer(handleHttp).listen(process.env.PORT || 3000);
if (!legalUrl()) console.warn('No PUBLIC_URL set: the guide will not link to the Terms of Use and Privacy Policy page.');

if (!process.env.DISCORD_TOKEN) {
  console.error('Missing DISCORD_TOKEN. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const client = new Client({
  // GuildMembers is a privileged intent: enable it in the developer portal (used for /announce and member checks).
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel, Partials.Message], // required to receive DMs
});
setStatusSource(() => uptimeStatus(client)); // the home page's status card

const EPHEMERAL = MessageFlags.Ephemeral;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* DMs where the user is in several servers: remember their text while they pick one. */
const pending = holdsImages(new Map()); // token -> { userId, text, image, note, expires }
setInterval(() => {
  const now = Date.now();
  for (const [token, p] of pending) if (p.expires < now) pending.delete(token);
}, 60_000).unref();

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  startUptime(c);
  for (const cfg of await db.configuredGuilds()) {
    const guild = c.guilds.cache.get(cfg.guild_id);
    if (guild) await ensureSticky(guild).catch((err) => console.error(`Sticky check failed for ${guild.id}:`, err));
  }
  startScheduler(c);
  startBackups(c);
  catchUpDms(c).catch((err) => console.error('DM catch-up failed:', err));
  // Online notices are slow (throttled DMs), so run them after the sticky checks and in the background.
  for (const cfg of await db.configuredGuilds()) {
    const guild = c.guilds.cache.get(cfg.guild_id);
    if (guild) notifyOnline(guild).catch((err) => console.error(`Online notice failed for ${guild.id}:`, err));
  }
});

/* ---------- DM: "fw <text>" (or the /fw slash command) ---------- */

/** Handle one DM. `catchUp` = it was sent while the bot was offline: no usage reply for non-submissions, and the user is told it was late. */
async function handleDm(message, catchUp = false) {
  const p = prefix();
  const usage =
    `To post anonymously, send:\n\`${p} <your message>\`\nAttach an image to include it in your post.\n\n` +
    `Extras, in this order: a topic \`${p} #memes <message>\`, a content warning \`${p} cw: spoilers | <message>\`, ` +
    `or a poll \`${p} poll 24h: Question? | Option A | Option B\` (the \`24h\` is optional).\n` +
    `Topics: ${dmTagList()}\n\n` +
    `Settings: \`${p} notify off\` (no DM when someone replies to you), \`${p} preview on\` (see your post and confirm before it goes up).\n\n` +
    `Or use the \`/fw\` command, which has options for all of these.`;
  const match = message.content.trim().match(new RegExp(`^${escapeRe(p)}(?:\\s+([\\s\\S]*))?$`, 'i'));
  if (!match) return catchUp ? undefined : message.author.send(usage).catch(() => {});

  const text = (match[1] ?? '').trim();
  const dm = (content) => message.author.send(content).catch(() => {});

  // "fw appeal <why>" from a banned user goes to the moderators. Anyone who is not banned anywhere: it is just a post.
  const appeal = text.match(/^appeal(?:\s+([\s\S]*))?$/i);
  if (appeal) {
    const banned = await bannedGuildsOf(client, message.author.id);
    if (banned.length) {
      const why = (appeal[1] ?? '').trim();
      if (!why) return dm(appealUsage());
      if (banned.length === 1) return dm(await submitBanAppeal(banned[0], message.author, why));
      const token = randomUUID().slice(0, 8);
      pending.set(token, { userId: message.author.id, appealText: why, expires: Date.now() + 5 * 60_000 });
      const menu = new StringSelectMenuBuilder()
        .setCustomId(`confess:pick:${token}`)
        .setPlaceholder('Which server?')
        .addOptions(banned.slice(0, 25).map((g) => ({ label: g.name.slice(0, 100), value: g.id })));
      return message.author.send({ content: 'You are banned in several servers. Which ban are you appealing?', components: [new ActionRowBuilder().addComponents(menu)] }).catch(() => {});
    }
  }

  // Personal settings: "fw notify off", "fw preview on".
  const pref = text.match(/^(notify|preview)\s+(on|off)$/i);
  if (pref) {
    const [which, on] = [pref[1].toLowerCase(), pref[2].toLowerCase() === 'on'];
    await db.setPref(message.author.id, which === 'notify' ? 'notify_off' : 'preview', which === 'notify' ? !on : on);
    return dm(
      which === 'notify'
        ? on ? 'Reply notifications are **on**.' : 'Reply notifications are **off**: I will not DM you when someone replies to your posts.'
        : on ? 'Previews are **on**: I will show you the post and ask before it goes up.' : 'Previews are **off**.',
    );
  }

  // Shortcuts before the message: #topic, "cw: label |", "poll 24h: question | a | b".
  const parsed = parseDmPost(text);
  if (parsed.error) return dm(parsed.error);
  const body = parsed.text;
  const extras = { tag: parsed.tag, cw: parsed.cw, pollOptions: parsed.pollOptions, pollHours: parsed.pollHours };

  const guilds = await candidateGuilds(client, message.author.id);
  if (guilds.length === 0) return dm('I found no server you are in that has submissions set up.');

  // One image per post, re-uploaded into the channel. Size cap = Discord's upload limit of the biggest candidate
  // server; submitConfession re-checks it against the server actually chosen.
  const limit = Math.max(...guilds.map(uploadLimit));
  const { image: attachment, extra, rejected } = pickImage(message.attachments, limit);
  if (!body && !attachment) return dm(rejected ? imageHelp(limit) : usage);
  if (body.length > MAX_LEN) return dm(`Too long. Max ${MAX_LEN} characters.`);

  let release = null;
  if (attachment) {
    // Download only for someone who could post in at least one of these servers right now.
    const blocks = await Promise.all(guilds.map((g) => whyCannotPost(g, message.author.id)));
    if (blocks.every(Boolean)) return dm(blocks[0]);
    release = claimUpload(message.author.id);
    if (!release) return dm(BUSY_MESSAGE);
  }

  try {
    let image = null;
    if (attachment) {
      try {
        image = await downloadImage(attachment, limit);
      } catch (err) {
        console.error('Image download failed:', err);
        return await dm('I could not download or read that image. Send it again, or save it as a PNG or JPG first.');
      }
    }
    const note = [extra ? 'Only the first image was used.' : '', rejected && attachment ? `Skipped a file I cannot use. ${imageHelp(limit)}` : '']
      .filter(Boolean)
      .join(' ');
    const late = catchUp ? ' I was offline when you sent it, so it went up late.' : '';
    const posted = (res, guild) => (res.ok ? `${resultText(res, guild, { inGuildName: true })}${late}${note ? `\n${note}` : ''}` : res.error);

    if (guilds.length === 1) {
      const out = await submitOrPreview(guilds[0], message.author.id, body, null, image, extras);
      return await dm(out.preview ?? posted(out.result, guilds[0]));
    }

    const token = randomUUID().slice(0, 8);
    keep(pending, token, { userId: message.author.id, text: body, image, note, extras, expires: Date.now() + 5 * 60_000 });
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`confess:pick:${token}`)
      .setPlaceholder('Which server?')
      .addOptions(guilds.slice(0, 25).map((g) => ({ label: g.name.slice(0, 100), value: g.id })));
    return await message.author
      .send({ content: `Which server should this go to?${late}`, components: [new ActionRowBuilder().addComponents(menu)] })
      .catch(() => {});
  } finally {
    release?.();
  }
}

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || message.guildId) return;
  try {
    if (!(await claimDm(message.author.id, message.id))) return; // the catch-up already took it
    await handleDm(message);
  } catch (err) {
    console.error('DM handling failed:', err);
    await message.author.send('Something broke on my side and your message may not have been sent. Try again in a moment.').catch(() => {});
  }
});

/** Move the user's DM cursor to this message. False when it was already handled, so nothing is posted twice. */
function claimDm(userId, messageId) {
  return withKeyLock(`dm:${userId}`, async () => {
    const current = await db.getDmCursor(userId);
    if (current && BigInt(messageId) <= BigInt(current)) return false;
    await db.setDmCursor(userId, messageId);
    return true;
  });
}

/* ---------- DM catch-up: submissions sent while the bot was offline ---------- */

const CATCHUP_MAX_AGE_MS = 24 * 60 * 60_000; // older than this is stale: ignored
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function catchUpDms(c) {
  for (const userId of await db.knownDmUsers()) {
    try {
      const user = await c.users.fetch(userId);
      const dm = await user.createDM();
      const cursor = await db.getDmCursor(userId);

      if (!cursor) {
        // First time we see this user: remember where their DM stands, process nothing old.
        const [latest] = (await dm.messages.fetch({ limit: 1 })).values();
        if (latest) await db.setDmCursor(userId, latest.id);
        continue;
      }

      const missed = [...(await dm.messages.fetch({ after: cursor, limit: 50 })).values()].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
      for (const message of missed) {
        // A live message may have moved the cursor while we were busy: never handle one twice.
        if (!(await claimDm(userId, message.id))) continue;
        if (message.author.bot || message.author.id !== userId) continue;
        if (Date.now() - message.createdTimestamp > CATCHUP_MAX_AGE_MS) continue;
        await handleDm(message, true);
      }
    } catch (err) {
      console.error(`DM catch-up failed for ${userId}:`, err.message);
    }
    await sleep(300);
  }
}

/* ---------- welcome DM ---------- */

client.on(Events.GuildMemberAdd, async (member) => {
  if (member.user.bot) return;
  const cfg = await db.getGuild(member.guild.id);
  if (cfg?.welcome_dm && cfg.channel_id) await dmGuide(member.user, member.guild).catch(() => {});
});

/* ---------- interactions ---------- */

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    await routeInteraction(interaction); // awaited here, so a failure in any handler lands in the catch below
  } catch (err) {
    console.error('Interaction error:', err);
    const payload = { content: 'Something broke on my side. Try again in a moment.', flags: EPHEMERAL };
    try {
      // followUp, never editReply: after deferUpdate an edit would overwrite the post or mod-log entry the button sits on.
      if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
      else if (interaction.isRepliable()) await interaction.reply(payload);
    } catch {
      /* interaction already expired */
    }
  }
});

async function routeInteraction(interaction) {
  if (interaction.isAutocomplete()) {
    const cmd = commands.get(interaction.commandName);
    if (cmd && interaction.options.getFocused(true).name === 'server') await serverAutocomplete(interaction, { admin: cmd.admin, manageOnly: cmd.manageOnly });
    return;
  }

  if (interaction.isChatInputCommand() || interaction.isMessageContextMenuCommand()) {
    await commands.get(interaction.commandName)?.execute(interaction);
    return;
  }

  // Moderation buttons under mod-log entries, and the reason pop-up they open.
  if (interaction.isButton() && interaction.customId.startsWith(`${CONTROL_PREFIX}:`)) {
    return handleControlButton(interaction);
  }
  if (interaction.isModalSubmit() && interaction.customId.startsWith(`${REASON_PREFIX}:`)) {
    return handleReasonModal(interaction);
  }

  // Lift / Deny buttons on a ban appeal in the mod log.
  if (interaction.isButton() && interaction.customId.startsWith(`${BAN_APPEAL_PREFIX}:`)) {
    return handleBanAppealButton(interaction);
  }

  // Overturn / Uphold buttons on a warning appeal in the mod log.
  if (interaction.isButton() && interaction.customId.startsWith(`${APPEAL_PREFIX}:`)) {
    return handleAppealButton(interaction);
  }

  // /clearwarn pick list and its Dismiss button.
  if ((interaction.isButton() || interaction.isStringSelectMenu()) && interaction.customId.startsWith(`${CLEARWARN_PREFIX}:`)) {
    return handleClearWarnComponent(interaction);
  }

  // "Appeal" button in a warning / ban DM -> dropdown of what can be appealed -> pop-up with the reason.
  if (interaction.isButton() && interaction.customId.startsWith(`${APPEAL_FORM_PREFIX}:`)) return handleAppealFormButton(interaction);
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith(`${APPEAL_PICK_PREFIX}:`)) return handleAppealPick(interaction);
  if (interaction.isModalSubmit() && interaction.customId.startsWith(`${APPEAL_MODAL_PREFIX}:`)) return handleAppealModal(interaction);

  // "Read the rules" button in a warning, ban or removal DM: opens the guide on its Rules page as a new message.
  if (interaction.isButton() && interaction.customId.startsWith(`${RULES_PREFIX}:`)) {
    const guild = client.guilds.cache.get(interaction.customId.split(':')[1]);
    if (!guild) return interaction.reply({ content: 'I can no longer reach that server.', flags: EPHEMERAL });
    return interaction.reply(await guidePayload(guild, RULES_PAGE));
  }

  // Guide page buttons ("guide:<guildId>:<page>"), in DMs or ephemeral /guide replies.
  if (interaction.isButton() && interaction.customId.startsWith(`${GUIDE_PREFIX}:`)) {
    const [, guildId, page] = interaction.customId.split(':');
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return interaction.reply({ content: 'I can no longer reach that server.', flags: EPHEMERAL });
    return interaction.update(await guidePayload(guild, Number(page)));
  }

  // "View Guide" button on the sticky: guide shown only to the clicker.
  if (interaction.isButton() && interaction.customId === GUIDE_BUTTON_ID) {
    if (!interaction.guild) return interaction.reply({ content: 'Use this button inside a server.', flags: EPHEMERAL });
    return interaction.reply({ ...await guidePayload(interaction.guild, 0), flags: EPHEMERAL });
  }

  if (interaction.isButton() && interaction.customId === OPEN_BUTTON_ID) {
    if (interaction.guildId && await db.getBan(interaction.guildId, interaction.user.id)) {
      return interaction.reply({ content: 'You are banned from posting in this server.', flags: EPHEMERAL });
    }
    const closed = interaction.guildId && closedNotice(await db.getGuild(interaction.guildId));
    if (closed) return interaction.reply({ content: closed, flags: EPHEMERAL });
    return interaction.showModal(confessModal());
  }

  // "Reply" button under a submission: open the modal aimed at that post.
  if (interaction.isButton() && interaction.customId === REPLY_BUTTON_ID) {
    if (await db.getBan(interaction.guildId, interaction.user.id)) {
      return interaction.reply({ content: 'You are banned from posting in this server.', flags: EPHEMERAL });
    }
    const target = await db.getConfessionByMessage(interaction.guildId, interaction.message.id);
    if (!target || target.status !== 'posted') {
      return interaction.reply({ content: 'That submission is no longer available to reply to.', flags: EPHEMERAL });
    }
    const closed = closedNotice(await db.getGuild(interaction.guildId));
    if (closed) return interaction.reply({ content: closed, flags: EPHEMERAL });
    // The OP choice is offered only to the author of the post (inside a thread: of the post the thread is under).
    const opOf = target.thread_root ? await db.getConfession(interaction.guildId, target.thread_root) : target;
    const own = opOf?.author_key === userKey(interaction.guildId, interaction.user.id);
    return interaction.showModal(confessModal({ messageId: interaction.message.id, number: target.number, own }));
  }

  // 👍 👎 and poll-option buttons under a submission.
  if (interaction.isButton() && interaction.customId.startsWith(`${REACT_PREFIX}:`)) return handleReactionButton(interaction);
  if (interaction.isButton() && interaction.customId.startsWith(`${VOTE_PREFIX}:`)) return handleVoteButton(interaction);

  // Close poll button, approval queue buttons (and the reject-reason pop-up), preview Post / Cancel.
  if (interaction.isButton() && interaction.customId === CLOSE_POLL_ID) return handleClosePollButton(interaction);
  if (interaction.isButton() && interaction.customId.startsWith(`${APPROVAL_PREFIX}:`)) return handleApprovalButton(interaction);
  if (interaction.isModalSubmit() && interaction.customId.startsWith(`${APPROVAL_REASON_PREFIX}:`)) return handleApprovalModal(interaction);
  if (interaction.isButton() && interaction.customId.startsWith(`${DRAFT_PREFIX}:`)) return handleDraftButton(interaction);

  // "Report" button under a submission, and its reason pop-up.
  if (interaction.isButton() && interaction.customId === REPORT_BUTTON_ID) return handleReportButton(interaction);
  if (interaction.isModalSubmit() && interaction.customId.startsWith(`${REPORT_MODAL_PREFIX}:`)) return handleReportModal(interaction);

  if (interaction.isModalSubmit() && interaction.customId.startsWith(MODAL_ID)) {
    await interaction.deferReply({ flags: EPHEMERAL });
    const replyTo = interaction.customId.split(':')[2] ?? null; // "confess:modal:<messageId>"
    const guild = interaction.guild ?? (await client.guilds.fetch(interaction.guildId));
    const upload = interaction.fields.getUploadedFiles('image')?.first();
    let release = null;
    if (upload) {
      const blocked = await whyCannotPost(guild, interaction.user.id);
      if (blocked) return interaction.editReply(blocked);
      release = claimUpload(interaction.user.id);
      if (!release) return interaction.editReply(BUSY_MESSAGE);
    }
    try {
      let image = null;
      if (upload) {
        const prepared = await prepareImage(upload, uploadLimit(guild));
        if (prepared.error) return await interaction.editReply(prepared.error);
        image = prepared.image;
      }
      // Topic is optional; the poll type exists only on new posts (not replies) and turns the post into a poll.
      const tag = interaction.fields.getStringSelectValues('tag')?.[0] ?? null;
      const text = interaction.fields.getTextInputValue('text');
      const cw = interaction.fields.getTextInputValue('cw');
      let kind = null;
      if (!replyTo) {
        try {
          kind = interaction.fields.getStringSelectValues('pollkind')?.[0] ?? null;
        } catch {
          /* a pop-up opened before this update has no poll type */
        }
      }
      if (kind === 'choice') {
        // Multiple choice: the options come from a second pop-up. Keep the first step (text, image) for ten minutes.
        const token = randomUUID().slice(0, 8);
        keep(pending, token, { userId: interaction.user.id, guildId: guild.id, text, image, tag, cw, expires: Date.now() + 10 * 60_000 });
        return await interaction.editReply({
          content: 'Multiple choice poll: add your options to finish. Nothing is posted until you do.',
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`${OPTIONS_BUTTON_PREFIX}:${token}`).setLabel('Add options').setStyle(ButtonStyle.Primary),
            ),
          ],
        });
      }
      const pollOptions = kind === 'yesno' ? [...YES_NO] : kind === 'likert' ? [...LIKERT] : null;
      let showOp = false;
      if (replyTo) {
        try {
          showOp = interaction.fields.getStringSelectValues('op')?.[0] === 'yes';
        } catch {
          /* the choice is only in the pop-up of the post's author */
        }
      }
      const out = await submitOrPreview(guild, interaction.user.id, text, replyTo, image, { tag, cw, pollOptions, showOp });
      return await interaction.editReply(out.preview ?? resultText(out.result, guild));
    } finally {
      release?.();
    }
  }

  // Multiple choice, step two: the "Add options" button opens the options pop-up, whose answer finishes the post.
  if (interaction.isButton() && interaction.customId.startsWith(`${OPTIONS_BUTTON_PREFIX}:`)) {
    const entry = pending.get(interaction.customId.split(':')[2]);
    if (!entry || entry.userId !== interaction.user.id) {
      return interaction.update({ content: 'That request expired. Write your submission again.', components: [] });
    }
    return interaction.showModal(optionsModal(interaction.customId.split(':')[2]));
  }
  if (interaction.isModalSubmit() && interaction.customId.startsWith(`${OPTIONS_MODAL_PREFIX}:`)) {
    const token = interaction.customId.split(':')[2];
    const entry = pending.get(token);
    if (!entry || entry.userId !== interaction.user.id) {
      return interaction.reply({ content: 'That request expired. Write your submission again.', flags: EPHEMERAL });
    }
    await interaction.deferReply({ flags: EPHEMERAL });
    const poll = parsePollOptions(interaction.fields.getTextInputValue('options'));
    if (poll.error) return interaction.editReply(`${poll.error} Press **Add options** again to retry.`);
    pending.delete(token);
    const guild = client.guilds.cache.get(entry.guildId) ?? (await client.guilds.fetch(entry.guildId));
    const out = await submitOrPreview(guild, entry.userId, entry.text, null, entry.image, { tag: entry.tag, cw: entry.cw, pollOptions: poll.options });
    return interaction.editReply(out.preview ?? resultText(out.result, guild));
  }

  // Owner PIN: the pop-up asking for it (/sender, /ownerpin) and the Dismiss button under a sender lookup.
  if (interaction.isModalSubmit() && interaction.customId.startsWith(`${PIN_MODAL_PREFIX}:`)) return handlePinModal(interaction);
  if (interaction.isButton() && interaction.customId === PIN_DISMISS_ID) return handlePinDismiss(interaction);

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('confess:pick:')) {
    const token = interaction.customId.split(':')[2];
    const entry = pending.get(token);
    if (!entry || entry.userId !== interaction.user.id) {
      return interaction.update({ content: 'That request expired. Send your submission again.', components: [] });
    }
    pending.delete(token);
    const appealing = entry.appealText !== undefined;
    await interaction.update({ content: appealing ? 'Sending your appeal...' : 'Posting...', components: [] });
    const guild = client.guilds.cache.get(interaction.values[0]);
    if (!guild) return interaction.editReply('I can no longer reach that server.');
    if (appealing) return interaction.editReply(await submitBanAppeal(guild, interaction.user, entry.appealText));
    const out = await submitOrPreview(guild, interaction.user.id, entry.text, null, entry.image, entry.extras ?? {});
    if (out.preview) return interaction.editReply(out.preview);
    return interaction.editReply(
      out.result.ok ? `${resultText(out.result, guild, { inGuildName: true })}${entry.note ? `\n${entry.note}` : ''}` : out.result.error,
    );
  }
}

// Without an 'error' listener, one failed event handler or gateway error takes the whole process down.
client.on(Events.Error, (err) => console.error('Client error:', err));
process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));
client.login(process.env.DISCORD_TOKEN);

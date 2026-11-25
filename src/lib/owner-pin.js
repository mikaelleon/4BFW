// Owner-only PIN. Sender IDs are hidden everywhere; only the server owner can ask for one (/sender), and only after
// typing their 6-digit PIN within 60 seconds. The PIN is made at /setup channel and DMed to the owner; /ownerpin changes it.
// Only a scrypt hash is stored.
import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import * as db from '../db.js';
import { COLOR, anonRef } from './format.js';
import { notice } from './moderation.js';

export const PIN_MODAL_PREFIX = 'ownerpin'; // modal "ownerpin:<token>"
export const PIN_DISMISS_ID = 'ownerpin:dismiss';
const PIN_WINDOW_MS = 60_000;
const MAX_FAILS = 3;
const LOCK_MS = 10 * 60_000;
const EPHEMERAL = MessageFlags.Ephemeral;

const pendingPrompts = new Map(); // token -> { userId, guildId, kind, subId, expires }
const failures = new Map(); // guildId -> { count, lockedUntil }
setInterval(() => {
  const now = Date.now();
  for (const [token, p] of pendingPrompts) if (p.expires < now) pendingPrompts.delete(token);
}, 60_000).unref();

/* ---------- PIN basics ---------- */

export const generatePin = () => String(randomInt(0, 1_000_000)).padStart(6, '0');
export const isValidPin = (text) => /^\d{6}$/.test(text);

function hashPin(pin) {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${scryptSync(pin, salt, 32).toString('hex')}`;
}

function matches(pin, stored) {
  const [saltHex, hashHex] = (stored ?? '').split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(pin, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(expected, actual);
}

export const hasPin = (guildId) => Boolean(db.getGuild(guildId)?.owner_pin);
const savePin = (guildId, pin) => db.updateGuild(guildId, { owner_pin: hashPin(pin) });

/** Three wrong PINs lock the lookups for ten minutes. */
function lockedFor(guildId) {
  const f = failures.get(guildId);
  return f?.lockedUntil > Date.now() ? Math.ceil((f.lockedUntil - Date.now()) / 60_000) : 0;
}

function checkPin(guildId, pin) {
  if (!matches(pin, db.getGuild(guildId)?.owner_pin)) {
    const f = failures.get(guildId) ?? { count: 0, lockedUntil: 0 };
    f.count += 1;
    if (f.count >= MAX_FAILS) {
      f.count = 0;
      f.lockedUntil = Date.now() + LOCK_MS;
    }
    failures.set(guildId, f);
    return false;
  }
  failures.delete(guildId);
  return true;
}

export async function isOwner(interaction) {
  const guild = interaction.guild ?? (await interaction.client.guilds.fetch(interaction.guildId).catch(() => null));
  return Boolean(guild) && guild.ownerId === interaction.user.id;
}

/** DM the owner a PIN. False when their DMs are closed. */
async function dmPin(guild, pin, reason) {
  try {
    const owner = await guild.client.users.fetch(guild.ownerId);
    await owner.send({
      embeds: [
        notice(
          `Your owner PIN for ${guild.name}`,
          `${reason}\n\n## \`${pin}\`\n\n` +
            'You need it to look up a sender ID with `/sender`. Keep it private. ' +
            'Change it any time with `/ownerpin`. Delete this message once you have saved it somewhere safe.',
        ),
      ],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Run at /setup: if the server has no PIN yet, make one and DM it to the owner.
 * 'sent' | 'exists' | 'dm_failed' (nothing is saved on failure, so the owner can pick one with /ownerpin).
 */
export async function ensureOwnerPin(guild) {
  if (hasPin(guild.id)) return 'exists';
  const pin = generatePin();
  if (!(await dmPin(guild, pin, 'Made when this server was set up.'))) return 'dm_failed';
  savePin(guild.id, pin);
  return 'sent';
}

/* ---------- the prompt ---------- */

const pinInput = (id, label, description, required) =>
  new LabelBuilder()
    .setLabel(label)
    .setDescription(description)
    .setTextInputComponent(
      new TextInputBuilder().setCustomId(id).setStyle(TextInputStyle.Short).setMinLength(required ? 6 : 0).setMaxLength(6).setRequired(required),
    );

/** Pop-up asking for the PIN (and a new one for kind "change"). Cancelled if not sent within 60 seconds. */
export function promptPin(interaction, kind, extra = {}) {
  const token = randomBytes(6).toString('hex');
  pendingPrompts.set(token, { userId: interaction.user.id, guildId: interaction.guildId, kind, ...extra, expires: Date.now() + PIN_WINDOW_MS });
  const modal = new ModalBuilder().setCustomId(`${PIN_MODAL_PREFIX}:${token}`).setTitle(kind === 'sender' ? 'Owner PIN' : 'Change owner PIN');
  if (kind === 'sender' || hasPin(interaction.guildId)) {
    modal.addLabelComponents(pinInput('pin', 'Your 6-digit PIN', 'You have 60 seconds. After that the request is cancelled.', true));
  }
  if (kind === 'change') {
    modal.addLabelComponents(pinInput('newpin', 'New PIN (optional)', 'Six digits. Leave empty and I will make one and DM it to you.', false));
  }
  return interaction.showModal(modal);
}

const dismissRow = () =>
  new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(PIN_DISMISS_ID).setLabel('Dismiss').setStyle(ButtonStyle.Secondary));

export async function handlePinModal(interaction) {
  const token = interaction.customId.split(':')[1];
  const prompt = pendingPrompts.get(token);
  pendingPrompts.delete(token);
  const say = (content) => interaction.reply({ content, flags: EPHEMERAL });

  if (!prompt || prompt.userId !== interaction.user.id || prompt.guildId !== interaction.guildId) return say('That request is no longer valid. Run the command again.');
  if (Date.now() > prompt.expires) return say('Cancelled: the PIN was not entered within 60 seconds. Run the command again.');
  if (!(await isOwner(interaction))) return say('Only the server owner can do this.');

  const guild = interaction.guild ?? (await interaction.client.guilds.fetch(interaction.guildId));
  const gated = prompt.kind === 'sender' || hasPin(guild.id);
  if (gated) {
    const wait = lockedFor(guild.id);
    if (wait) return say(`Too many wrong PINs. Try again in ${wait} minute${wait === 1 ? '' : 's'}.`);
    const typed = interaction.fields.getTextInputValue('pin').trim();
    if (!isValidPin(typed) || !checkPin(guild.id, typed)) return say('Wrong PIN. The request was cancelled.');
  }

  if (prompt.kind === 'sender') {
    const row = db.getConfessionBySubId(guild.id, prompt.subId);
    if (!row) return say(`There is no submission with ID \`${prompt.subId}\` in this server.`);
    const embed = new EmbedBuilder()
      .setColor(COLOR)
      .setTitle(`Sender of Submission ID ${row.sub_id}`)
      .setDescription(
        (row.author_id ? `\`${row.author_id}\` (<@${row.author_id}>)` : '*Erased by data retention.*') +
          `\n\nPublic number ${row.number ? anonRef(row.number) : '(not posted yet)'} · ${row.status}`,
      )
      .setFooter({ text: 'Only you can see this. Dismiss it when you are done.' });
    return interaction.reply({ embeds: [embed], components: [dismissRow()], flags: EPHEMERAL, allowedMentions: { parse: [] } });
  }

  // kind "change"
  const wanted = interaction.fields.getTextInputValue('newpin').trim();
  if (wanted && !isValidPin(wanted)) return say('The new PIN must be exactly 6 digits. Nothing was changed.');
  const pin = wanted || generatePin();
  if (!wanted && !(await dmPin(guild, pin, 'Made at your request.'))) {
    return say('I could not DM you (are your DMs closed?). Nothing was changed. Open your DMs, or type a PIN yourself.');
  }
  savePin(guild.id, pin);
  return say(wanted ? 'Your new PIN is saved.' : 'Done. The new PIN is in your DMs.');
}

/** "Dismiss" button under a sender lookup: removes the ephemeral message. */
export async function handlePinDismiss(interaction) {
  await interaction.deferUpdate();
  await interaction.deleteReply().catch(() => {});
}

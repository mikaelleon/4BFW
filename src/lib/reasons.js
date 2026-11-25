// Preset reasons for the dropdown at the top of the Warn / Delete / Ban / Report pop-ups.
import { LabelBuilder, StringSelectMenuBuilder } from 'discord.js';

export const REASONS = {
  // Reasons users pick when flagging a post
  report: [
    'Harassment or Bullying',
    'Hate Speech or Discrimination',
    'Naming or Doxxing Someone',
    'Sexual or Explicit Content',
    'Threats or Violence',
    'Self-Harm Concern',
    'Spam or Advertising',
    'Misinformation',
    'Impersonation',
    'Defamation or False Accusations',
    'Privacy Violation',
    'Off-Topic',
    'Wrong Topic or Tag',
    'Duplicate Post',
    'Other',
  ],
  // Post is allowed, but the author gets a notice
  warn: [
    'Mild Profanity',
    'Insensitive Language',
    'Borderline Harassment',
    'Mentioning an Identifiable Person',
    'Misleading Tag or Topic',
    'Off-Topic Post',
    'Spam-Like Posting',
    'Excessive Posting',
    'Unverified Claims',
    'Missing Content Warning',
    'First Offense',
  ],
  // Author loses posting access
  ban: [
    'Repeated Violations',
    'Severe Harassment or Bullying',
    'Hate Speech',
    'Threats or Incitement to Violence',
    'Doxxing or Sharing Private Information',
    'Sexual or Explicit Content',
    'Impersonation',
    'Ban Evasion',
    'Coordinated Spam or Bot Activity',
    'Defamation',
    'Ignored Previous Warnings',
  ],
  // Post is removed
  delete: [
    'Violates Community Guidelines',
    'Harassment or Bullying',
    'Hate Speech',
    'Contains Personal Information',
    'Names an Identifiable Person',
    'Sexual or Explicit Content',
    'Threats or Violence',
    'Spam or Advertising',
    'Misinformation',
    'Duplicate Post',
    'Off-Topic',
    'Author Requested Removal',
    'Posted in Error',
    'Legal or Safety Concern',
    'Other',
  ],
};

export const PRESET_ID = 'preset'; // custom id of the dropdown

/** The dropdown (inside a label) that goes at the top of a pop-up. */
export function reasonDropdown(kind, { required = false } = {}) {
  return new LabelBuilder().setLabel('Reason').setStringSelectMenuComponent(
    new StringSelectMenuBuilder()
      .setCustomId(PRESET_ID)
      .setPlaceholder('Pick a reason')
      .setRequired(required)
      .setMinValues(required ? 1 : 0)
      .setMaxValues(1)
      .addOptions(REASONS[kind].map((r) => ({ label: r, value: r }))),
  );
}

/** Dropdown choice + the typed details -> one reason string, or null when both are empty. */
export function combineReason(preset, details) {
  const extra = (details ?? '').trim();
  if (preset && extra) return `${preset}: ${extra}`.slice(0, 500);
  return preset || extra || null;
}

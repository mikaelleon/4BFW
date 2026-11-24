import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

/** Prefix of the buttons under a mod-log entry: "mod:<action>:<submission id>". */
export const CONTROL_PREFIX = 'mod';

/** Warn / Delete / Ban (or Unban when the author is already banned). Delete greys out once the post is gone; Restore shows while it is auto-hidden. */
export function controlsRow(row, banned) {
  const id = (action) => `${CONTROL_PREFIX}:${action}:${row.id}`;
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(id('warn')).setLabel('Warn').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(id('delete'))
      .setLabel('Delete')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(row.status === 'deleted'),
    banned
      ? new ButtonBuilder().setCustomId(id('unban')).setLabel('Unban').setStyle(ButtonStyle.Secondary)
      : new ButtonBuilder().setCustomId(id('ban')).setLabel('Ban').setStyle(ButtonStyle.Danger),
  );
  if (row.status === 'hidden') {
    buttons.addComponents(new ButtonBuilder().setCustomId(id('restore')).setLabel('Restore').setStyle(ButtonStyle.Success));
  }
  return buttons;
}

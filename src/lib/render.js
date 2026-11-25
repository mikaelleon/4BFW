// How a post's text and image are laid out in Discord (shared by posting, restoring, featuring and highlights).
import { AttachmentBuilder } from 'discord.js';
import { PAD_NAME, padPng } from './pad.js';

export const MAX_CW_LEN = 60;

/** With a content warning the text sits behind a spoiler, under a visible warning line. */
export function renderBody(body, cw) {
  if (!cw) return body ?? '';
  const warning = `⚠️ **Content warning: ${cw}**`;
  return body ? `${warning}\n||${body}||` : warning;
}

/**
 * Files to upload and the attachment name the embed image should point at.
 * A picture under a content warning goes up as a SPOILER_ attachment next to the embed (embed images cannot be
 * blurred), and the embed keeps the transparent width pad.
 */
export function postFiles(image, cw) {
  const pad = () => new AttachmentBuilder(padPng(), { name: PAD_NAME });
  if (!image) return { files: [pad()], imageName: PAD_NAME };
  if (!cw) return { files: [new AttachmentBuilder(image.buffer, { name: image.name })], imageName: image.name };
  return { files: [pad(), new AttachmentBuilder(image.buffer, { name: `SPOILER_${image.name}` })], imageName: PAD_NAME };
}

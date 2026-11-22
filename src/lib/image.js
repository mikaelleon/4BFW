// Image attachments for DM submissions.

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // safely under Discord's default 10 MB upload limit
export const IMAGE_HELP = 'Only PNG, JPG, GIF or WEBP images up to 8 MB work.';

const TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
const EXT_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

function extensionOf(att) {
  const type = (att.contentType ?? '').split(';')[0].trim().toLowerCase();
  if (TYPES[type]) return TYPES[type];
  const fromName = att.name?.split('.').pop()?.toLowerCase();
  return EXT_TYPES[fromName] ? TYPES[EXT_TYPES[fromName]] : null;
}

/**
 * Look through a DM's attachments.
 * Returns { image } (first usable one), { extra } (usable ones ignored), { rejected } (something unusable).
 */
export function pickImage(attachments) {
  const usable = [];
  let rejected = false;
  for (const att of attachments.values()) {
    if (extensionOf(att) && att.size <= MAX_IMAGE_BYTES) usable.push(att);
    else rejected = true;
  }
  return { image: usable[0] ?? null, extra: Math.max(0, usable.length - 1), rejected };
}

/**
 * Download the image so it can be re-uploaded to the server channel (DM attachment links expire).
 * The original filename is dropped on purpose: names can identify the sender.
 */
export async function downloadImage(att) {
  const res = await fetch(att.url);
  if (!res.ok) throw new Error(`download failed (${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error('image too large');
  return { buffer, name: `image.${extensionOf(att)}` };
}

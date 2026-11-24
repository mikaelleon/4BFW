// Image attachments for submissions (DM, /fw option, modal upload).

const MIB = 1024 * 1024;
// Discord's upload limit per server boost tier. A post is re-uploaded by the bot, so the server's limit applies.
const TIER_LIMITS = [10 * MIB, 10 * MIB, 50 * MIB, 100 * MIB];

/** Largest file the bot can upload to this server (Discord's own limit for its boost tier). */
export const uploadLimit = (guild) => TIER_LIMITS[guild?.premiumTier ?? 0] ?? TIER_LIMITS[0];

const fmtMb = (bytes) => `${Math.round(bytes / MIB)} MB`;
export const imageHelp = (limit) => `Only PNG, JPG, GIF or WEBP images up to ${fmtMb(limit)} work.`;

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
export function pickImage(attachments, limit) {
  const usable = [];
  let rejected = false;
  for (const att of attachments.values()) {
    if (extensionOf(att) && att.size <= limit) usable.push(att);
    else rejected = true;
  }
  return { image: usable[0] ?? null, extra: Math.max(0, usable.length - 1), rejected };
}

/**
 * Download the image so it can be re-uploaded to the server channel (DM attachment links expire).
 * The original filename is dropped on purpose: names can identify the sender.
 */
export async function downloadImage(att, limit) {
  const res = await fetch(att.url);
  if (!res.ok) throw new Error(`download failed (${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > limit) throw new Error('image too large');
  return { buffer, name: `image.${extensionOf(att)}` };
}

/** One attachment (slash option or modal upload) -> { image } ready for submitConfession, or { error } for the user. */
export async function prepareImage(att, limit) {
  const { image } = pickImage([att], limit);
  if (!image) return { error: imageHelp(limit) };
  try {
    return { image: await downloadImage(image, limit) };
  } catch (err) {
    console.error('Image download failed:', err);
    return { error: 'I could not download that image. Try again.' };
  }
}

// Shared by the backup job and the startup restore. Backups hold author IDs, so they are always encrypted.
// File layout: iv (12 bytes) | auth tag (16 bytes) | AES-256-GCM(gzip(sqlite file)).
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

export const BACKUP_PREFIX = 'confessions-backup-';
export const BACKUP_SUFFIX = '.db.gz.enc';

const key = () => scryptSync(process.env.BACKUP_PASSPHRASE, 'confessions-bot-backup', 32);

export const backupEnabled = () => Boolean(process.env.BACKUP_CHANNEL_ID && process.env.BACKUP_PASSPHRASE);

export function encryptDb(buf) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(gzipSync(buf)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

export function decryptDb(buf) {
  const decipher = createDecipheriv('aes-256-gcm', key(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return gunzipSync(Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]));
}

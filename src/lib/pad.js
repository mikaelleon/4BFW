import { crc32, deflateSync } from 'node:zlib';

/**
 * A wide, fully transparent PNG. Attached to an embed as its image, it makes Discord render the embed at
 * full width whatever the text length, so mod-log entries line up. Generated in code: no asset file needed.
 */
export const PAD_NAME = 'pad.png';

const WIDTH = 800;
const HEIGHT = 4;
let cached;

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

export function padPng() {
  if (cached) return cached;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(WIDTH, 0);
  header.writeUInt32BE(HEIGHT, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const row = Buffer.alloc(1 + WIDTH * 4); // filter byte 0 + transparent pixels
  const raw = Buffer.concat(Array.from({ length: HEIGHT }, () => row));
  cached = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return cached;
}

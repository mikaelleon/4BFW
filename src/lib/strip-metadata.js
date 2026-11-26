// Removes metadata (GPS position, camera, owner name, comments, hidden thumbnails, appended files) from an image before
// it is stored or re-uploaded, without re-encoding the picture. Only the parts needed to draw it are copied over, so
// anything unknown is dropped. The file type is read from the bytes, not from the name Discord reports.

const fail = (why) => {
  throw new Error(`unreadable image: ${why}`);
};

/** `n` bytes at `at`, or an error when the file is cut short. */
function take(buf, at, n) {
  if (n < 0 || at + n > buf.length) fail('truncated');
  return buf.subarray(at, at + n);
}

const startsWith = (buf, text) => buf.length >= text.length && buf.toString('latin1', 0, text.length) === text;

/* ---------- JPEG ---------- */

/** The Exif orientation (1-8) in an APP1 payload, or 1. */
function exifOrientation(data) {
  if (!startsWith(data, 'Exif\0\0')) return 1;
  const tiff = data.subarray(6);
  const little = startsWith(tiff, 'II');
  if (!little && !startsWith(tiff, 'MM')) return 1;
  const u16 = (at) => (little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at));
  try {
    const ifd = little ? tiff.readUInt32LE(4) : tiff.readUInt32BE(4);
    for (let i = 0, n = u16(ifd); i < n; i++) {
      const entry = ifd + 2 + i * 12;
      if (u16(entry) === 0x0112) {
        const value = u16(entry + 8);
        return value >= 1 && value <= 8 ? value : 1;
      }
    }
  } catch {
    /* broken Exif: treat as upright */
  }
  return 1;
}

/** An APP1 segment holding only the orientation, so phone photos do not end up sideways. */
function orientationSegment(value) {
  const body = Buffer.from([
    0x45, 0x78, 0x69, 0x66, 0, 0, // "Exif\0\0"
    0x4d, 0x4d, 0, 42, 0, 0, 0, 8, // big-endian TIFF header, first directory at 8
    0, 1, // one entry
    0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, value, 0, 0, // Orientation, SHORT, count 1
    0, 0, 0, 0, // no further directory
  ]);
  return Buffer.concat([Buffer.from([0xff, 0xe1, 0, body.length + 2]), body]);
}

function jpeg(buf) {
  const out = [];
  let orientation = 1;
  let at = 2; // after the start-of-image marker
  for (;;) {
    if (take(buf, at, 1)[0] !== 0xff) fail('bad JPEG marker');
    while (buf[at + 1] === 0xff) at++; // fill bytes
    const marker = take(buf, at, 2)[1];
    if (marker === 0xd9) break; // end of image: whatever follows (extra pictures, video) is dropped
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push(take(buf, at, 2));
      at += 2;
      continue;
    }
    const length = take(buf, at + 2, 2).readUInt16BE(0);
    if (length < 2) fail('bad JPEG segment');
    const segment = take(buf, at, length + 2);
    const data = segment.subarray(4);
    at += segment.length;

    if (marker === 0xe1) orientation = orientation === 1 ? exifOrientation(data) : orientation;
    const isApp = marker >= 0xe0 && marker <= 0xef;
    const wanted =
      (marker === 0xe0 && startsWith(data, 'JFIF\0')) ||
      (marker === 0xe2 && startsWith(data, 'ICC_PROFILE\0')) || // colour profile
      (marker === 0xee && startsWith(data, 'Adobe')) || // needed to decode some colour spaces
      (!isApp && marker !== 0xfe); // 0xfe = comment
    if (wanted) out.push(segment);

    if (marker === 0xda) {
      // Compressed picture data runs until the next real marker (0xff00 and restart markers belong to the data).
      let end = at;
      for (;;) {
        end = buf.indexOf(0xff, end);
        if (end < 0 || end + 1 >= buf.length) {
          end = buf.length;
          break;
        }
        const next = buf[end + 1];
        if (next !== 0x00 && next !== 0xff && !(next >= 0xd0 && next <= 0xd7)) break;
        end += 1;
      }
      out.push(buf.subarray(at, end));
      at = end;
      if (at >= buf.length) break; // no end marker: viewers accept it, so do we
    }
  }
  const head = [buf.subarray(0, 2)];
  if (orientation !== 1) head.push(orientationSegment(orientation));
  return Buffer.concat([...head, ...out, Buffer.from([0xff, 0xd9])]);
}

/* ---------- PNG ---------- */

const PNG_SIGNATURE = '\x89PNG\r\n\x1a\n';
const PNG_KEEP = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'cHRM', 'gAMA', 'iCCP', 'sBIT', 'sRGB', 'cICP', 'bKGD', 'pHYs', 'hIST', 'acTL', 'fcTL', 'fdAT']);

function png(buf) {
  const out = [buf.subarray(0, 8)];
  let at = 8;
  for (;;) {
    const length = take(buf, at, 4).readUInt32BE(0);
    const chunk = take(buf, at, length + 12); // length, type, data, checksum
    const type = chunk.toString('latin1', 4, 8);
    if (PNG_KEEP.has(type)) out.push(chunk);
    at += chunk.length;
    if (type === 'IEND') return Buffer.concat(out);
  }
}

/* ---------- WEBP ---------- */

const WEBP_KEEP = new Set(['VP8 ', 'VP8L', 'VP8X', 'ALPH', 'ANIM', 'ANMF', 'ICCP']);

function webp(buf) {
  const end = 8 + buf.readUInt32LE(4);
  if (end > buf.length) fail('truncated');
  const out = [];
  let at = 12;
  while (at < end) {
    const size = take(buf, at, 8).readUInt32LE(4);
    const chunk = take(buf, at, 8 + size);
    const type = chunk.toString('latin1', 0, 4);
    if (WEBP_KEEP.has(type)) {
      const copy = Buffer.alloc(8 + size + (size % 2)); // chunks are padded to an even length
      chunk.copy(copy);
      if (type === 'VP8X' && size >= 1) copy[8] &= ~0x0c; // clear the "has Exif" and "has XMP" flags
      out.push(copy);
    }
    at += 8 + size + (size % 2);
  }
  const body = Buffer.concat([Buffer.from('WEBP', 'latin1'), ...out]);
  const header = Buffer.alloc(8);
  header.write('RIFF', 'latin1');
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

/* ---------- GIF ---------- */

/** End position of a run of length-prefixed sub-blocks (closed by an empty one). */
function subBlocksEnd(buf, at) {
  for (;;) {
    const size = take(buf, at, 1)[0];
    at += 1;
    if (!size) return at;
    take(buf, at, size);
    at += size;
  }
}

const colourTable = (flags) => (flags & 0x80 ? 3 * 2 ** ((flags & 7) + 1) : 0);

function gif(buf) {
  let at = 13 + colourTable(take(buf, 0, 13)[10]);
  const out = [take(buf, 0, at)];
  for (;;) {
    if (at >= buf.length) break; // no trailer: viewers accept it, so do we
    const kind = buf[at];
    if (kind === 0x3b) break; // trailer: anything after it is dropped
    if (kind === 0x2c) {
      const flags = take(buf, at, 10)[9];
      const end = subBlocksEnd(buf, at + 10 + colourTable(flags) + 1); // +1 = LZW code size
      out.push(buf.subarray(at, end));
      at = end;
    } else if (kind === 0x21) {
      const label = take(buf, at, 2)[1];
      const end = subBlocksEnd(buf, at + 2);
      const app = label === 0xff ? buf.toString('latin1', at + 3, at + 14) : '';
      // Keep frame timing and the loop count. Comments, text and other application blocks (XMP) are dropped.
      if (label === 0xf9 || app === 'NETSCAPE2.0' || app === 'ANIMEXTS1.0') out.push(buf.subarray(at, end));
      at = end;
    } else fail('bad GIF block');
  }
  return Buffer.concat([...out, Buffer.from([0x3b])]);
}

/** -> { buffer, ext } with the metadata gone. Throws for anything that is not a readable PNG, JPG, GIF or WEBP. */
export function stripMetadata(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { buffer: jpeg(buf), ext: 'jpg' };
  if (startsWith(buf, PNG_SIGNATURE)) return { buffer: png(buf), ext: 'png' };
  if (startsWith(buf, 'GIF87a') || startsWith(buf, 'GIF89a')) return { buffer: gif(buf), ext: 'gif' };
  if (buf.length >= 12 && startsWith(buf, 'RIFF') && buf.toString('latin1', 8, 12) === 'WEBP') return { buffer: webp(buf), ext: 'webp' };
  return fail('unknown format');
}

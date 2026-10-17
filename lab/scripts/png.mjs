// A small PNG reader (and writer, for tests and fixtures) on node:zlib, so the lab needs no image library.
//   decodePng(bytes) -> { width, height, rgba }   8-bit RGB or RGBA, not interlaced; anything else is refused with a
//                                                 message that says what to do. rgba is width × height × 4 bytes.
//   encodePng({ width, height, rgba }) -> bytes   8-bit RGBA, no filtering
import { crc32, deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const MAX_SIDE = 8192;
export const MAX_PIXELS = 4096 * 4096;
const COLOUR_TYPES = { 0: 'greyscale', 2: 'RGB', 3: 'palette', 4: 'greyscale with alpha', 6: 'RGBA' };

const fail = (message) => Object.assign(new Error(message), { code: 'not-png' });
export const isPng = (bytes) => !!bytes && bytes.length >= 8 && Buffer.from(bytes.buffer, bytes.byteOffset, 8).equals(SIGNATURE);

// The chunks of a PNG, each { type, data }, with their CRCs checked.
function chunks(bytes) {
  const out = [];
  let at = 8;
  while (at + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(at), type = bytes.toString('latin1', at + 4, at + 8);
    if (at + 12 + length > bytes.length) throw fail('This PNG is cut short (a chunk runs past the end of the file).');
    const data = bytes.subarray(at + 8, at + 8 + length);
    if (crc32(bytes.subarray(at + 4, at + 8 + length)) !== bytes.readUInt32BE(at + 8 + length)) throw fail(`This PNG is damaged (the ${type} chunk does not match its checksum).`);
    out.push({ type, data });
    at += 12 + length;
    if (type === 'IEND') break;
  }
  return out;
}

function header(data) {
  if (!data || data.length !== 13) throw fail('This PNG has no valid header (IHDR).');
  return { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], colourType: data[9], interlace: data[12] };
}

const paeth = (a, b, c) => {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

// Undoes the per-row filters (PNG spec, section 9) in place; returns the raw rows without their filter bytes.
function unfilter(raw, width, height, bpp) {
  const stride = width * bpp, out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], src = y * (stride + 1) + 1, row = y * stride, prev = row - stride;
    if (filter > 4) throw fail(`This PNG is damaged (row ${y} has an unknown filter ${filter}).`);
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i], a = i >= bpp ? out[row + i - bpp] : 0, b = y ? out[prev + i] : 0, c = y && i >= bpp ? out[prev + i - bpp] : 0;
      out[row + i] = (filter === 0 ? x : filter === 1 ? x + a : filter === 2 ? x + b : filter === 3 ? x + ((a + b) >> 1) : x + paeth(a, b, c)) & 255;
    }
  }
  return out;
}

export function decodePng(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (!isPng(buf)) throw fail('This file is not a PNG.');
  const list = chunks(buf);
  if (list[0]?.type !== 'IHDR') throw fail('This PNG has no valid header (IHDR).');
  const { width, height, depth, colourType, interlace } = header(list[0].data);
  if (!width || !height) throw fail('This PNG is empty (0 pixels wide or high).');
  if (width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS) throw fail(`This picture is too big (${width} × ${height}); use one of at most ${MAX_SIDE} pixels a side and ${MAX_PIXELS / 1048576} megapixels.`);
  if (depth !== 8 || (colourType !== 2 && colourType !== 6)) {
    throw fail(`Only 8-bit RGB or RGBA PNGs can be read; this one is ${depth}-bit ${COLOUR_TYPES[colourType] || `colour type ${colourType}`}. Save it again as an 8-bit RGB or RGBA PNG (or add it through the lab's new-character page, which converts it).`);
  }
  if (interlace) throw fail('Interlaced PNGs cannot be read; save the picture again without interlacing.');
  const idat = list.filter((c) => c.type === 'IDAT');
  if (!idat.length) throw fail('This PNG has no image data.');
  const bpp = colourType === 6 ? 4 : 3, expected = (width * bpp + 1) * height;
  let raw;
  try { raw = inflateSync(Buffer.concat(idat.map((c) => c.data)), { maxOutputLength: expected }); }
  catch { throw fail('This PNG is damaged (its image data does not unpack to its size).'); }
  if (raw.length !== expected) throw fail('This PNG is damaged (its image data does not match its size).');
  const px = unfilter(raw, width, height, bpp);
  if (bpp === 4) return { width, height, rgba: px };
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0, j = 0; i < px.length; i += 3, j += 4) { rgba[j] = px[i]; rgba[j + 1] = px[i + 1]; rgba[j + 2] = px[i + 2]; rgba[j + 3] = 255; }
  return { width, height, rgba };
}

const chunk = (type, data) => {
  const head = Buffer.alloc(8), tail = Buffer.alloc(4);
  head.writeUInt32BE(data.length, 0); head.write(type, 4, 'latin1');
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
};

export function encodePng({ width, height, rgba }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

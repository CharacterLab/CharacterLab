import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync, crc32 } from 'node:zlib';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { decodePng, encodePng } from '../lab/scripts/png.mjs';
import { detectBox, isValidId, makePack, slugify } from '../lab/scripts/pack-maker.mjs';
import { findBox } from '../lab/js/lab-box.mjs';
import { checkPack } from '../lab/scripts/lab-vm.mjs';

// The pack maker (lab/scripts/pack-maker.mjs), its PNG reader (png.mjs) and the box finder it shares with the
// new-character page (lab/js/lab-box.mjs), on pictures made here.

// A width × height picture of one background colour with a filled rectangle [x, y, w, h] of another.
function picture(width, height, bg, rect = null, fg = [200, 40, 40, 255]) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const inside = rect && x >= rect[0] && x < rect[0] + rect[2] && y >= rect[1] && y < rect[1] + rect[3];
    rgba.set(inside ? fg : bg, (y * width + x) * 4);
  }
  return { width, height, rgba };
}

// A PNG chunk and a PNG of any header and raw (already filtered) rows, to test the reader against other encoders' output.
const chunk = (type, data) => {
  const len = Buffer.alloc(4), crc = Buffer.alloc(4), body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
function rawPng({ width, height, depth = 8, colourType = 2, interlace = 0, rows }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = depth; ihdr[9] = colourType; ihdr[12] = interlace;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

test('decodePng reads 8-bit RGB and RGBA through every row filter', () => {
  // 3 × 5 RGB, one row per filter (none, sub, up, average, paeth), each encoded by hand from the same pixels
  const px = [[10, 20, 30], [40, 50, 60], [70, 80, 90]];
  const row = (y) => px.map(([r, g, b]) => [r + y, g + y, b + y]);
  const orig = [0, 1, 2, 3, 4].map(row), bpp = 3;
  const flat = (r) => r.flat();
  const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  const rows = orig.map((r, y) => {
    const cur = flat(r), prev = y ? flat(orig[y - 1]) : cur.map(() => 0);
    const enc = cur.map((x, i) => {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      return (x - [0, a, b, (a + b) >> 1, paeth(a, b, c)][y] + 256) & 255;
    });
    return Buffer.from([y, ...enc]);
  });
  const img = decodePng(rawPng({ width: 3, height: 5, rows: Buffer.concat(rows) }));
  assert.equal(img.width, 3); assert.equal(img.height, 5);
  for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) {
    assert.deepEqual([...img.rgba.subarray((y * 3 + x) * 4, (y * 3 + x) * 4 + 4)], [...orig[y][x], 255], `pixel ${x},${y}`);
  }
  const rgba = picture(7, 4, [1, 2, 3, 128], [2, 1, 3, 2], [250, 251, 252, 255]);
  assert.deepEqual(decodePng(encodePng(rgba)), rgba, 'an RGBA picture comes back as it went in');
});

test('decodePng refuses what it cannot read, saying what to do', () => {
  const rows = Buffer.alloc(3 * 2 + 2);
  assert.throws(() => decodePng(Buffer.from('GIF89a not a png')), /not a PNG/);
  assert.throws(() => decodePng(rawPng({ width: 2, height: 2, depth: 16, rows })), /8-bit RGB or RGBA.*16-bit RGB/);
  assert.throws(() => decodePng(rawPng({ width: 2, height: 2, colourType: 3, rows })), /palette/);
  assert.throws(() => decodePng(rawPng({ width: 2, height: 2, colourType: 0, rows })), /greyscale/);
  assert.throws(() => decodePng(rawPng({ width: 2, height: 2, interlace: 1, rows: Buffer.alloc(14) })), /Interlaced/);
  assert.throws(() => decodePng(rawPng({ width: 9000, height: 2, rows })), /too big/);
  assert.throws(() => decodePng(rawPng({ width: 4, height: 4, rows })), /damaged/, 'image data shorter than its size');
  const png = encodePng(picture(4, 4, [9, 9, 9, 255]));
  png[png.length - 20] ^= 0xff;
  assert.throws(() => decodePng(png), /damaged/, 'a checksum that does not match');
  for (const bad of [() => decodePng(Buffer.alloc(0)), () => decodePng(png.subarray(0, 30))]) assert.throws(bad, (e) => e.code === 'not-png');
});

test('detectBox finds the figure against the corners\' background, with a margin, clamped to the sheet', () => {
  const sheet = picture(200, 100, [240, 240, 236, 255], [50, 20, 60, 40]);
  assert.deepEqual(detectBox(encodePng(sheet)), [46, 16, 68, 48], 'a 4-pixel margin on a 200-pixel sheet');
  assert.deepEqual(findBox(sheet.rgba, 200, 100, { margin: 0 }), [50, 20, 60, 40]);
  assert.deepEqual(detectBox(encodePng(picture(100, 100, [240, 240, 236, 255], [0, 90, 30, 10]))), [0, 86, 34, 14], 'clamped at the edges');
  assert.deepEqual(detectBox(encodePng(picture(64, 48, [12, 34, 56, 255]))), [0, 0, 64, 48], 'nothing on it: the whole sheet');
  // faint noise below the threshold is background; a transparent sheet's figure is what is opaque
  const noisy = picture(100, 100, [200, 200, 200, 255], [30, 30, 10, 10]);
  for (let i = 0; i < noisy.rgba.length; i += 4 * 7) noisy.rgba[i] += 12;
  assert.deepEqual(findBox(noisy.rgba, 100, 100, { margin: 0 }), [30, 30, 10, 10]);
  const clear = picture(100, 100, [255, 255, 255, 0], [10, 60, 20, 30], [255, 255, 255, 255]);
  assert.deepEqual(findBox(clear.rgba, 100, 100, { margin: 0 }), [10, 60, 20, 30]);
  // the background is the colour most corners share, even with the figure touching one corner
  const corner = picture(100, 100, [250, 250, 250, 255], [0, 0, 40, 40]);
  assert.deepEqual(findBox(corner.rgba, 100, 100, { margin: 0 }), [0, 0, 40, 40]);
});

test('isValidId and slugify make pack ids from names', () => {
  for (const ok of ['star-girl', 'a', 'kite2', 'b-2-c']) assert.ok(isValidId(ok), ok);
  for (const bad of ['', 'Star', '2star', 'star-', 'a--b', 'star_girl', 'x'.repeat(41), null, 7]) assert.ok(!isValidId(bad), String(bad));
  assert.equal(slugify('Star Girl!'), 'star-girl');
  assert.equal(slugify('  Ñandú  the 2nd '), 'nandu-the-2nd');
  assert.equal(slugify('42 Captain Kite'), 'captain-kite');
  assert.equal(slugify('???'), '');
  assert.ok(slugify('a'.repeat(80)).length <= 40);
});

test('makePack makes a pack checkPack accepts: the front cropped to its box, more sheets as more variants', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pack-maker-'));
  const front = encodePng(picture(120, 160, [238, 240, 243, 255], [30, 20, 60, 120]));
  const side = encodePng(picture(100, 100, [238, 240, 243, 255], [40, 10, 20, 80]));
  const made = await makePack({ id: 'test-hero', label: 'Test "Hero"', dir, sheets: [{ name: 'Front view', data: front }, { name: 'Side view', data: side }, { name: 'Side view', data: side }] });
  assert.equal(made.dir, join(dir, 'test-hero'));
  assert.deepEqual(made.size, [120, 160]);
  assert.deepEqual(made.box, [26, 16, 68, 128], 'found from the picture');
  assert.deepEqual(made.variants.map((v) => [v.id, v.sheet]), [['test-hero-front', 'sheets/front.png'], ['test-hero-side-view', 'sheets/side-view.png'], ['test-hero-side-view-2', 'sheets/side-view-2.png']]);
  assert.deepEqual(made.variants[1].frame, [36, 6, 28, 88]);
  assert.deepEqual([...made.files].sort(), ['pack.json', 'sheets/front.png', 'sheets/side-view-2.png', 'sheets/side-view.png', 'test-hero.js', 'tests/pack.test.mjs']);
  assert.deepEqual(await readFile(join(made.dir, 'sheets', 'front.png')), front, 'the sheet is kept byte for byte');
  const def = await checkPack(pathToFileURL(`${made.dir}/`));
  assert.equal(def.label, 'Test "Hero"', 'a name with quotes stays a string');
  const js = await readFile(join(made.dir, 'test-hero.js'), 'utf8');
  assert.match(js, /frame: \[26, 16, 68, 128\]/);
  assert.match(js, /const BACKDROP = "#eef0f3"/, 'the backdrop is the sheet\'s own background');
  const manifest = JSON.parse(await readFile(join(made.dir, 'pack.json'), 'utf8'));
  assert.equal(manifest.thumb, 'sheets/front.png');

  const given = await makePack({ id: 'boxed', dir, sheets: [{ name: 'front', data: front }], box: [0, 0, 120, 160] });
  assert.deepEqual(given.box, [0, 0, 120, 160]);
  assert.equal((await checkPack(pathToFileURL(`${given.dir}/`))).label, 'Boxed', 'no label: the id in title case');
});

test('makePack refuses bad input and leaves nothing behind', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pack-maker-'));
  const png = encodePng(picture(40, 40, [255, 255, 255, 255], [10, 10, 10, 10]));
  const code = (c) => (e) => e.code === c;
  await assert.rejects(makePack({ id: 'Bad Id', dir, sheets: [{ data: png }] }), code('bad-id'));
  await assert.rejects(makePack({ id: 'ok', label: 'two\nlines', dir, sheets: [{ data: png }] }), code('bad-label'));
  await assert.rejects(makePack({ id: 'ok', dir, sheets: [] }), code('no-sheets'));
  await assert.rejects(makePack({ id: 'ok', dir, sheets: Array(9).fill({ data: png }) }), code('too-many-sheets'));
  await assert.rejects(makePack({ id: 'ok', dir, sheets: [{ data: Buffer.from('nope') }] }), code('not-png'));
  await assert.rejects(makePack({ id: 'ok', dir, sheets: [{ data: png }], box: [30, 30, 20, 20] }), code('bad-box'));
  await assert.rejects(makePack({ id: 'ok', dir, sheets: [{ data: png }, { data: png, box: [0, 0, 2, 2] }] }), code('bad-box'));
  assert.deepEqual(await readdir(dir), [], 'no folder for a refused pack');
  await makePack({ id: 'once', dir, sheets: [{ data: png }] });
  await writeFile(join(dir, 'once', 'mine.txt'), 'kept');
  await assert.rejects(makePack({ id: 'once', dir, sheets: [{ data: png }] }), code('exists'));
  assert.ok(existsSync(join(dir, 'once', 'mine.txt')), 'an existing pack is never touched');
});

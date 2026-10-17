// Starts a character pack from one or more reference pictures: the scaffolding behind `npm run new-pack` and the lab's
// new-character page (POST /api/characters in server.mjs).
//   makePack({ id, label, dir, sheets: [{ name, file?, data?, box? }], box? })
//     -> { dir, id, files, box, size, variants }
//   Makes <dir>/<id>/: pack.json, <id>.js (one whole-figure variant per sheet, drawn as a placeholder ellipse to
//   replace), sheets/<name>.png and tests/pack.test.mjs. The first sheet is the front (sheets/front.png, variant
//   <id>-front, cropped to `box`); every other sheet is one more whole-figure variant, cropped to its own `box`. A box
//   left out is found from the picture (detectBox). `file` is a PNG on disk, `data` its bytes. Nothing is left behind
//   when it fails; an existing pack folder is never touched (error code "exists").
//   detectBox(pngBytes) -> [x, y, w, h]   the figure's box: pixels unlike the corners' background, plus a margin
//   isValidId(id), slugify(label)         pack ids: lowercase letters, digits and single dashes, starting with a letter
// Errors carry a `code`: bad-id, bad-label, no-sheets, too-many-sheets, not-png, bad-box, exists.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { LAB_DIR } from '../../lab-config.mjs';
import { backgroundOf, checkBox, findBox } from '../js/lab-box.mjs';
import { ID_MAX, LABEL_MAX, MAX_SHEETS, isValidId, slugify } from '../js/lab-pack-rules.mjs';
import { decodePng } from './png.mjs';

const fail = (code, message) => Object.assign(new Error(message), { code });

export { isValidId, slugify };

export function detectBox(png) {
  const { width, height, rgba } = decodePng(png);
  return findBox(rgba, width, height);
}

const titleCase = (id) => id.split('-').map((s) => s[0].toUpperCase() + s.slice(1)).join(' ');
const hex = ([r, g, b]) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

function cleanLabel(label, id) {
  if (label == null || label === '') return titleCase(id);
  // one line of plain text: it goes into pack.json, the pack's script (quoted) and a comment
  const s = typeof label === 'string' && !/[\u0000-\u001f\u007f\u2028\u2029]/.test(label) ? label.trim().replace(/ +/g, ' ') : '';
  if (!s || s.length > LABEL_MAX) throw fail('bad-label', `The name must be one line of at most ${LABEL_MAX} characters.`);
  return s;
}

// Sheet file names: the first is "front"; the others their name made safe, each one once.
function sheetNames(sheets) {
  const used = new Set();
  return sheets.map((s, i) => {
    let base = i === 0 ? 'front' : slugify(s.name) || `sheet-${i + 1}`, name = base;
    for (let n = 2; used.has(name); n++) name = `${base}-${n}`;
    used.add(name);
    return name;
  });
}

async function readSheet(s, i) {
  if (!s || typeof s !== 'object') throw fail('no-sheets', `Picture ${i + 1} is missing.`);
  const data = s.data != null ? Buffer.from(s.data) : s.file ? await readFile(s.file).catch(() => { throw fail('not-png', `Cannot read ${s.file}.`); }) : null;
  if (!data) throw fail('no-sheets', `Picture ${i + 1} has no file or data.`);
  let img;
  try { img = decodePng(data); } catch (e) { throw fail('not-png', `${i === 0 ? 'The front picture' : `Picture ${i + 1}`}: ${e.message}`); }
  return { data, ...img };
}

function boxFor(given, img, i) {
  if (given == null) return findBox(img.rgba, img.width, img.height);
  const box = checkBox(given, img.width, img.height);
  if (!box) throw fail('bad-box', `The crop box of ${i === 0 ? 'the front picture' : `picture ${i + 1}`} must be whole pixels x,y,w,h (at least 8 × 8) inside its ${img.width} × ${img.height} picture.`);
  return box;
}

const q = JSON.stringify;

function packScript({ id, label, backdrop, variants }) {
  const [front, ...more] = variants, [x, y, bw, bh] = front.frame, [w, h] = front.size;
  const variantLine = (v) => `{ id: ${q(v.id)}, label: ${q(v.label)}, sheet: ${q(v.id)}, kind: "mapped",
        frame: ${q(v.frame).replace(/,/g, ', ')}, scale: 1, fit: { s: 1, tx: ${-v.frame[0]}, ty: ${-v.frame[1]} }, build: ${v.build} }`;
  return `// ${label}: drawn in code, scored against its reference sheets (sheets/). Work in each sheet's own pixels: measure
// a shape on the sheet, then draw it here. Replace the placeholder ellipses with the character's real shapes.
(function () {
  const CL = window.CharacterLab;
  const { ellipse } = CL.lab.geom;          // also: spline(points, closed), rng(seed), flat(hex)
  const INK = "#281e28";
  // The cel material: a flat colour, one hard shadow (ramp[0]), an even outline. See the top of lab/js/wc-gl.js.
  const cel = (base, shade) => ({ type: 8, ramp: [shade, shade, base, base], line: INK, lineW: 3, shadow: 12, clean: true });
  const BACKDROP = ${q(backdrop)};               // the front sheet's background colour, read from its corners
  const backdrop = (w, h) => ({ kind: "fill", pts: [[0, 0], [w, 0], [w, h], [0, h]], mat: { type: 8, ramp: Array(4).fill(BACKDROP), lineW: 0, shadow: 0, clean: true }, seed: 1 });

  // The front (sheets/front.png). p: the lab's face params (eyes, mouth, look, …); honour the ones your character has.
  function build(p = {}) {
    return {
      world: [${w}, ${h}],
      ops: [
        backdrop(${w}, ${h}),
        // placeholder: one shape over the figure's box
        { kind: "fill", pts: ellipse(${x + bw / 2}, ${y + bh / 2}, ${Math.round(bw * 0.4)}, ${Math.round(bh * 0.45)}), mat: cel("#7aa6ff", "#4f78cc"), seed: 2 },
      ],
    };
  }
${more.length ? `
  // The other sheets: a placeholder each, over the figure's box on that sheet, in that sheet's pixels.
  const placeholder = ([w, h], [x, y, bw, bh]) => (p = {}) => ({
    world: [w, h],
    ops: [backdrop(w, h), { kind: "fill", pts: ellipse(x + bw / 2, y + bh / 2, Math.round(bw * 0.4), Math.round(bh * 0.45)), mat: cel("#7aa6ff", "#4f78cc"), seed: 2 }],
  });
` : ''}
  CL.lab.registerCharacter({
    id: ${q(id)}, label: ${q(label)},
    sheetsBase: ${q(`/packs/${id}/sheets/`)},
    sheets: {
${variants.map((v) => `      ${q(v.id)}: { file: ${q(v.file)}, name: ${q(`${label} ${v.label.toLowerCase()} sheet`)} },`).join('\n')}
    },
    parts: [{
      id: ${q(id)}, label: "Whole", whole: true,
      variants: [
        ${variants.map(variantLine).join(',\n        ')},
      ],
    }],
  });
})();
`;
}

function packTest(id, testDir) {
  const vm = relative(testDir, join(LAB_DIR, 'lab', 'scripts', 'lab-vm.mjs')).split('\\').join('/');
  return `import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPack } from '${vm.startsWith('.') ? vm : './' + vm}';

test('the ${id} pack is well formed and registers its character', async () => {
  const def = await checkPack(new URL('../', import.meta.url));
  assert.equal(def.id, '${id}');
});
`;
}

export async function makePack({ id, label, dir, sheets, box } = {}) {
  if (!isValidId(id)) throw fail('bad-id', `"${String(id).slice(0, 60)}" cannot be a pack id: use lowercase letters, digits and single dashes, starting with a letter (at most ${ID_MAX}).`);
  const name = cleanLabel(label, id);
  if (!dir) throw new Error('makePack needs the folder to make the pack in (dir)');
  if (!Array.isArray(sheets) || !sheets.length) throw fail('no-sheets', 'Add at least one picture: the front of the character.');
  if (sheets.length > MAX_SHEETS) throw fail('too-many-sheets', `At most ${MAX_SHEETS} pictures per character.`);
  const images = [];
  for (const [i, s] of sheets.entries()) images.push(await readSheet(s, i));   // one at a time: each can be large
  const names = sheetNames(sheets);
  const variants = images.map((img, i) => {
    const frame = boxFor(i === 0 ? box : sheets[i].box, img, i), size = [img.width, img.height];
    return { id: i === 0 ? `${id}-front` : `${id}-${names[i]}`, label: titleCase(names[i]), file: `${names[i]}.png`, frame, size,
      build: i === 0 ? 'build' : `placeholder(${q(size)}, ${q(frame)})` };
  });
  const backdrop = hex(backgroundOf(images[0].rgba, images[0].width, images[0].height));

  const root = resolve(dir), packDir = join(root, id);
  await mkdir(root, { recursive: true });
  try { await mkdir(packDir); }
  catch (e) { throw e.code === 'EEXIST' ? fail('exists', `There is already a character "${id}" (${packDir}).`) : e; }
  const files = [];
  const put = async (path, content) => { await writeFile(join(packDir, path), content); files.push(path); };
  try {
    await mkdir(join(packDir, 'sheets'));
    await mkdir(join(packDir, 'tests'));
    for (const [i, img] of images.entries()) await put(`sheets/${variants[i].file}`, img.data);
    const manifest = { id, label: name, version: '0.1.0', engine: '>=0.1.0', license: 'UNLICENSED', private: true,
      description: `${name}, drawn in code.`, scripts: [`${id}.js`], sheetsBase: `/packs/${id}/sheets/`, thumb: 'sheets/front.png' };
    await put('pack.json', JSON.stringify(manifest, null, 2) + '\n');
    await put(`${id}.js`, packScript({ id, label: name, backdrop, variants }));
    await put('tests/pack.test.mjs', packTest(id, join(packDir, 'tests')));
  } catch (e) {
    await rm(packDir, { recursive: true, force: true });
    throw e;
  }
  return { dir: packDir, id, files, box: variants[0].frame, size: variants[0].size,
    variants: variants.map(({ id: v, label: l, file, frame }) => ({ id: v, label: l, sheet: `sheets/${file}`, frame })) };
}

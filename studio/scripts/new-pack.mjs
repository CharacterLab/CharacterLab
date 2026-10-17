// `npm run new-pack -- <id> --sheet=<png> [--label="My Hero"] [--box=x,y,w,h] [--dir=packs]`
// Starts a character pack: <dir>/<id>/ with pack.json, <id>.js (one whole-figure variant on the sheet, drawn as a
// placeholder ellipse to replace), sheets/front.png and tests/pack.test.mjs. The box is the figure's crop on the sheet
// (default: the whole sheet). A pack outside the lab's packs/ folder loads with LAB_PACKS=<dir> or lab.config.json.
import { mkdir, readFile, writeFile, copyFile, access } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { LAB_DIR } from '../../lab-config.mjs';

const ID = /^[a-z][a-z0-9-]*$/;

function parseArgs(argv) {
  const opts = { _: [] };
  for (const a of argv) {
    const m = /^--([a-z]+)=(.*)$/.exec(a);
    if (m) opts[m[1]] = m[2];
    else opts._.push(a);
  }
  return opts;
}

// A PNG's size, read from its IHDR chunk (bytes 16–23).
async function pngSize(file) {
  const b = await readFile(file);
  const sig = b.subarray(0, 8).toString('hex');
  if (sig !== '89504e470d0a1a0a') throw new Error(`${file} is not a PNG`);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

function parseBox(text, [w, h]) {
  if (!text) return [0, 0, w, h];
  const box = text.split(',').map(Number);
  if (box.length !== 4 || box.some((n) => !Number.isFinite(n) || n < 0)) throw new Error('--box needs x,y,w,h in pixels');
  if (box[0] + box[2] > w || box[1] + box[3] > h) throw new Error(`--box goes outside the ${w}×${h} sheet`);
  return box;
}

const titleCase = (id) => id.split('-').map((s) => s[0].toUpperCase() + s.slice(1)).join(' ');

function packScript({ id, label, size: [w, h], box: [x, y, bw, bh] }) {
  const cx = x + bw / 2, cy = y + bh / 2;
  return `// ${label}: drawn in code, scored against sheets/front.png. Work in the sheet's pixels: measure a shape on the
// sheet, then draw it here. Replace the placeholder ellipse with the character's real shapes.
(function () {
  const CL = window.CharacterLab;
  const { ellipse } = CL.lab.geom;          // also: spline(points, closed), rng(seed), flat(hex)
  const INK = "#281e28";
  // The cel material: a flat colour, one hard shadow (ramp[0]), an even outline. See the top of studio/js/wc-gl.js.
  const cel = (base, shade) => ({ type: 8, ramp: [shade, shade, base, base], line: INK, lineW: 3, shadow: 12, clean: true });
  const BACKDROP = "#eef0f3";               // the sheet's background colour: set it to what your sheet uses

  // p: the studio's face params (eyes, mouth, look, …); honour the ones your character has.
  function build(p = {}) {
    return {
      world: [${w}, ${h}],
      ops: [
        { kind: "fill", pts: [[0, 0], [${w}, 0], [${w}, ${h}], [0, ${h}]], mat: { type: 8, ramp: Array(4).fill(BACKDROP), lineW: 0, shadow: 0, clean: true }, seed: 1 },
        // placeholder: one shape over the figure's box
        { kind: "fill", pts: ellipse(${cx}, ${cy}, ${Math.round(bw * 0.4)}, ${Math.round(bh * 0.45)}), mat: cel("#7aa6ff", "#4f78cc"), seed: 2 },
      ],
    };
  }

  CL.lab.registerCharacter({
    id: "${id}", label: "${label}",
    sheetsBase: "/packs/${id}/sheets/",
    sheets: { "${id}-front": { file: "front.png", name: "${label} front sheet" } },
    parts: [{
      id: "${id}", label: "Whole", whole: true,
      variants: [{ id: "${id}-front", label: "Front", sheet: "${id}-front", kind: "mapped",
        frame: [${x}, ${y}, ${bw}, ${bh}], scale: 1, fit: { s: 1, tx: ${-x}, ty: ${-y} }, build }],
    }],
  });
})();
`;
}

function packTest(id, testDir) {
  const vm = relative(testDir, join(LAB_DIR, 'studio', 'scripts', 'lab-vm.mjs')).split('\\').join('/');
  return `import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPack } from '${vm.startsWith('.') ? vm : './' + vm}';

test('the ${id} pack is well formed and registers its character', async () => {
  const def = await checkPack(new URL('../', import.meta.url));
  assert.equal(def.id, '${id}');
});
`;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cwd = process.env.INIT_CWD || process.cwd();   // npm run starts in the lab's folder; INIT_CWD is where it was typed
  const [id] = opts._;
  if (!id || !ID.test(id)) throw new Error('usage: npm run new-pack -- <id> --sheet=<png> [--label=…] [--box=x,y,w,h] [--dir=packs]\n  <id>: lowercase letters, digits and dashes, starting with a letter');
  if (!opts.sheet) throw new Error('--sheet=<png> is required: a reference picture of the character on a plain background');
  const sheet = resolve(cwd, opts.sheet);
  const size = await pngSize(sheet);
  const box = parseBox(opts.box, size);
  const dir = resolve(cwd, opts.dir || join(LAB_DIR, 'packs'), id);
  if (await access(dir).then(() => true, () => false)) throw new Error(`${dir} already exists`);
  const label = opts.label || titleCase(id);

  await mkdir(join(dir, 'sheets'), { recursive: true });
  await mkdir(join(dir, 'tests'), { recursive: true });
  await copyFile(sheet, join(dir, 'sheets', 'front.png'));
  const manifest = { id, label, version: '0.1.0', engine: '>=0.1.0', license: 'UNLICENSED', private: true,
    description: `${label}, drawn in code.`, scripts: [`${id}.js`], sheetsBase: `/packs/${id}/sheets/` };
  await writeFile(join(dir, 'pack.json'), JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(join(dir, `${id}.js`), packScript({ id, label, size, box }));
  await writeFile(join(dir, 'tests', 'pack.test.mjs'), packTest(id, join(dir, 'tests')));

  const inLab = relative(join(LAB_DIR, 'packs'), dir) === id;
  const parent = resolve(dir, '..'), rel = relative(LAB_DIR, parent);
  const env = inLab ? '' : `LAB_PACKS=${rel && !rel.startsWith('..') ? rel : parent} `;
  console.log(`Made ${dir}/ (${size[0]}×${size[1]} sheet, figure box ${box.join(',')}).
Next:
  ${env}npm start                              # the studio shows ${label}
  ${env}npm run lab -- score --part=${id}    # its score
  ${env}npm run lab -- sheet --v=${id}-front # out/sheets/: painting | code | difference
Then replace the placeholder in ${id}.js with real shapes, and score again.`);
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; });

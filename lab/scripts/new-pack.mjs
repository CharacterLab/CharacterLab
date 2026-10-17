// `npm run new-pack -- <id> --sheet=<png> [--sheet=<more.png> …] [--label="My Hero"] [--box=x,y,w,h] [--dir=packs]`
// Starts a character pack (lab/scripts/pack-maker.mjs): <dir>/<id>/ with pack.json, <id>.js (one whole-figure variant
// per sheet, drawn as a placeholder ellipse to replace), sheets/front.png (the first --sheet) and tests/pack.test.mjs.
// --box is the figure's crop on the front sheet; left out, it is found from the picture (pixels unlike the background).
// Each further --sheet adds a variant with its own found box. A pack outside the lab's packs/ folder loads with
// LAB_PACKS=<dir> or lab.config.json.
import { basename, extname, join, relative, resolve } from 'node:path';
import { LAB_DIR } from '../../lab-config.mjs';
import { makePack } from './pack-maker.mjs';

const USAGE = 'usage: npm run new-pack -- <id> --sheet=<png> [--sheet=<png> …] [--label=…] [--box=x,y,w,h] [--dir=packs]\n  <id>: lowercase letters, digits and dashes, starting with a letter';

function parseArgs(argv) {
  const opts = { _: [], sheet: [] };
  for (const a of argv) {
    const m = /^--([a-z]+)=(.*)$/.exec(a);
    if (!m) opts._.push(a);
    else if (m[1] === 'sheet') opts.sheet.push(m[2]);
    else opts[m[1]] = m[2];
  }
  return opts;
}

function parseBox(text) {
  if (!text) return undefined;
  const box = text.split(',').map(Number);
  if (box.length !== 4 || box.some((n) => !Number.isInteger(n) || n < 0)) throw new Error('--box needs x,y,w,h in whole pixels');
  return box;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cwd = process.env.INIT_CWD || process.cwd();   // npm run starts in the lab's folder; INIT_CWD is where it was typed
  const [id] = opts._;
  if (!id) throw new Error(USAGE);
  if (!opts.sheet.length) throw new Error('--sheet=<png> is required: a reference picture of the character on a plain background');
  const sheets = opts.sheet.map((f) => ({ name: basename(f, extname(f)), file: resolve(cwd, f) }));
  const made = await makePack({ id, label: opts.label, dir: resolve(cwd, opts.dir || join(LAB_DIR, 'packs')), sheets, box: parseBox(opts.box) });

  const inLab = relative(join(LAB_DIR, 'packs'), made.dir) === id;
  const parent = resolve(made.dir, '..'), rel = relative(LAB_DIR, parent);
  const env = inLab ? '' : `LAB_PACKS=${rel && !rel.startsWith('..') ? rel : parent} `;
  console.log(`Made ${made.dir}/ (${made.size.join('×')} front sheet, figure box ${made.box.join(',')}${opts.box ? '' : ', found from the picture'}${made.variants.length > 1 ? `; ${made.variants.length} variants` : ''}).
Next:
  ${env}npm start                              # the lab shows it at /lab/?char=${id}
  ${env}npm run characterlab -- score --part=${id}    # its score
  ${env}npm run characterlab -- sheet --v=${id}-front # out/sheets/: painting | code | difference
Then replace the placeholder in ${id}.js with real shapes, and score again.`);
}

main().catch((e) => { console.error(e.code === 'bad-id' ? `${e.message}\n${USAGE}` : e.message); process.exitCode = 1; });

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { checkPack } from '../lab/scripts/lab-vm.mjs';

// `npm run new-pack`: a new pack outside the lab that checkPack accepts, with its sheet, test and crop.
const LAB_DIR = fileURLToPath(new URL('../', import.meta.url));
const SHEET = join(LAB_DIR, 'examples', 'blob', 'sheets', 'front.png');
const run = (args) => spawnSync(process.execPath, ['lab/scripts/new-pack.mjs', ...args], { cwd: LAB_DIR, encoding: 'utf8' });

test('new-pack makes a pack that loads, with the figure box as its crop', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'new-pack-'));
  const r = run(['test-hero', `--sheet=${SHEET}`, '--box=96,96,320,320', `--dir=${dir}`, '--label=Test Hero']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /LAB_PACKS=/);
  const pack = join(dir, 'test-hero');
  for (const f of ['pack.json', 'test-hero.js', 'sheets/front.png', 'tests/pack.test.mjs']) assert.ok(existsSync(join(pack, f)), f);
  const def = await checkPack(new URL(`file://${pack}/`));
  assert.equal(def.label, 'Test Hero');
  assert.match(await readFile(join(pack, 'test-hero.js'), 'utf8'), /frame: \[96, 96, 320, 320\]/);
});

test('new-pack finds the figure box from the picture when --box is left out, and takes more sheets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'new-pack-'));
  const r = run(['auto-box', `--sheet=${SHEET}`, `--sheet=${SHEET}`, `--dir=${dir}`]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /found from the picture; 2 variants/);
  const js = await readFile(join(dir, 'auto-box', 'auto-box.js'), 'utf8');
  const [x, y, w, h] = JSON.parse(/frame: (\[[^\]]+\])/.exec(js)[1]);
  assert.ok(x > 0 && y > 0 && x + w < 512 && y + h < 512 && w > 100 && h > 100, `the box ${[x, y, w, h]} is around Blob, inside the sheet`);
  assert.ok(existsSync(join(dir, 'auto-box', 'sheets', 'front-2.png')), 'the second sheet keeps its own file');
  assert.equal((await checkPack(new URL(`file://${join(dir, 'auto-box')}/`))).id, 'auto-box');
});

test('new-pack refuses a bad id, a missing sheet, a box off the sheet and an existing folder', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'new-pack-'));
  assert.notEqual(run(['Bad_Id', `--sheet=${SHEET}`, `--dir=${dir}`]).status, 0);
  assert.notEqual(run(['ok-id', `--dir=${dir}`]).status, 0);
  assert.notEqual(run(['ok-id', `--sheet=${SHEET}`, '--box=400,400,200,200', `--dir=${dir}`]).status, 0);
  assert.equal(run(['twice', `--sheet=${SHEET}`, `--dir=${dir}`]).status, 0);
  assert.notEqual(run(['twice', `--sheet=${SHEET}`, `--dir=${dir}`]).status, 0);
});

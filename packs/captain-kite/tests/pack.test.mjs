import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, mkdtemp } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { checkPack, loadLab } from '../../../lab/scripts/lab-vm.mjs';

// Captain Kite, the open-source example pack: its manifest and registration, every variant's scene, the face params,
// the rig and clips, its sheets and license, no private words, and (with Chrome) its scores above a floor.
const PACK = new URL('../', import.meta.url);
const LAB_DIR = fileURLToPath(new URL('../../../', import.meta.url));
const lab = () => loadLab({ packs: [PACK] });
const variants = (CharacterLab) => CharacterLab.wcElements.parts.filter((p) => p.character === 'captain-kite').flatMap((p) => p.variants);
const finiteOps = (scene) => scene.ops.every((op) => !op.pts || (op.pts.length >= 3 && op.pts.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))));

test('the pack is well formed and registers Captain Kite with his sheets under /packs/captain-kite/sheets/', async () => {
  const def = await checkPack(PACK);
  assert.equal(def.id, 'captain-kite');
  assert.equal(def.label, 'Captain Kite');
  const m = JSON.parse(await readFile(new URL('pack.json', PACK), 'utf8'));
  assert.equal(m.license, 'CC0-1.0');
  assert.equal(m.private, false);
  assert.ok(m.order > 10, 'comes after the configured cast');
  assert.ok(existsSync(new URL(m.icon, PACK)), 'ships its icon');
  for (const s of Object.values(def.sheets)) assert.ok(existsSync(new URL(`sheets/${s.file}`, PACK)), `${s.file} is in sheets/`);
  assert.match(await readFile(new URL('sheets/LICENSE.md', PACK), 'utf8'), /CC0/);
});

test('every variant draws: cel fills with finite outlines, in sheet pixels', async () => {
  const CharacterLab = await lab(), list = variants(CharacterLab);
  assert.ok(list.length >= 26, `${list.length} variants`);
  for (const v of list) {
    assert.ok(v.id.startsWith('kite-'), v.id);
    assert.ok(v.kind === 'mapped' && v.frame.length === 4 && v.fit.s > 0, `${v.id}: a crop with a fit`);
    const scene = v.build({});
    assert.ok(scene.ops.length > 10, `${v.id}: ops`);
    assert.ok(finiteOps(scene), `${v.id}: finite outlines`);
    assert.ok(scene.ops.filter((op) => op.kind === 'fill').every((op) => op.mat.type === 8), `${v.id}: only the cel material`);
    assert.ok(scene.ops.every((op) => !op.mat || !op.mat.type || op.mat.clean), `${v.id}: clean cel (no paper grain)`);
  }
});

test('the face params change the face and nothing else, for every preset and mouth', async () => {
  const CharacterLab = await lab(), x = CharacterLab.lab.character('captain-kite').expressions;
  const still = (s) => JSON.stringify(s.ops.filter((op) => !op.dyn));
  const base = x.build({});
  for (const [name, e] of Object.entries(x.presets)) {
    const s = x.build(e.p);
    assert.ok(finiteOps(s), name);
    assert.equal(still(s), still(base), `${name}: the still regions are untouched`);
  }
  const faces = new Set();
  for (const mouth of Object.keys(x.mouths)) faces.add(JSON.stringify(x.build({ mouth }).ops.filter((op) => op.part === 'mouth')));
  assert.ok(faces.size >= Object.keys(x.mouths).length - 1, 'each mouth draws its own shape');
  const eyes = (p) => JSON.stringify(x.build(p).ops.filter((op) => op.part === 'eyes'));
  assert.notEqual(eyes({ eyes: 'happy' }), eyes({}));
  assert.notEqual(eyes({ eyes: 'closed' }), eyes({ eyes: 'happy' }));
  assert.notEqual(eyes({ lid: 1 }), eyes({}));
  assert.notEqual(eyes({ look: 1 }), eyes({}));
  const brows = (p) => JSON.stringify(x.build(p).ops.filter((op) => op.part === 'brows'));
  assert.notEqual(brows({ brows: 'determined' }), brows({ brows: 'sad' }));
  // Milo: the civilian front wears his glasses, and they come off
  const civ = variants(CharacterLab).find((v) => v.id === 'kite-civilian');
  assert.ok(civ.build({}).ops.length > civ.build({ glasses: false }).ops.length);
  // the outfit switch: the same front in his civilian clothes
  assert.notEqual(JSON.stringify(x.build({ outfit: 'civilian' }).ops), JSON.stringify(base.ops));
});

test('the rig and the clips: a blink and the waving hand', async () => {
  const CharacterLab = await lab();
  const wave = CharacterLab.wcAnim.clips['kite-wave'], blink = CharacterLab.wcAnim.clips['kite-blink'];
  assert.ok(wave && blink, 'both clips registered');
  const v = variants(CharacterLab).find((x) => x.id === 'kite-pose-wave');
  const at = (t) => { const m = CharacterLab.wcAnim.sample(wave, t); return CharacterLab.wcRig.flatten(v.build(Object.assign({}, m.p, { pose: m.pose }))); };
  const hand = (s) => JSON.stringify(s.ops.filter((op) => op.part === 'hand'));
  assert.ok(v.build({}).ops.some((op) => op.part === 'hand'), 'the waving pose has a hand part');
  assert.notEqual(hand(at(0)), hand(at(0.3)), 'the hand moves');
  const front = variants(CharacterLab).find((x) => x.id === 'kite-front');
  const lidAt = (t) => CharacterLab.wcAnim.sample(blink, t).p.lid || 0;
  assert.ok(lidAt(0.1) > 0.9 && lidAt(0.4) < 0.05);
  assert.ok(finiteOps(front.build({ lid: 1 })));
});

// Scores, measured with the lab's scorer (npm run lab -- score) when Chrome is there: each variant stays above the
// floor set from its measured fidelity (about 3 points under it).
const FLOOR = {
  'kite-front': 85, 'kite-civilian': 83, 'kite-turn-front': 78, 'kite-turn-3q': 79, 'kite-turn-side': 77, 'kite-turn-back': 80,
  'kite-head': 77, 'kite-mask': 62, 'kite-torso': 85, 'kite-belt': 77, 'kite-cape': 87, 'kite-arm-r': 85, 'kite-arm-l': 85, 'kite-legs': 81,
  'kite-expr-neutral': 74, 'kite-expr-happy': 76, 'kite-expr-surprised': 74, 'kite-expr-determined': 75, 'kite-expr-sad': 77, 'kite-expr-laughing': 75,
  'kite-pose-walk': 82, 'kite-pose-wave': 81, 'kite-pose-sit': 85, 'kite-pose-lookup': 84, 'kite-pose-landing': 79, 'kite-pose-flying': 80,
};
const CHROME = process.env.CHROME || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/google-chrome');
test('every variant scores above its floor', { skip: !existsSync(CHROME) && 'no Chrome to render with', timeout: 600000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kite-score-'));
  const rows = [];
  for (const part of ['captain-kite', 'kite-parts', 'kite-expressions', 'kite-poses']) {
    const save = join(dir, `${part}.json`);
    const r = spawnSync(process.execPath, ['lab/scripts/wc-lab.mjs', 'score', `--part=${part}`, `--save=${save}`], { cwd: LAB_DIR, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    rows.push(...JSON.parse(await readFile(save, 'utf8')));
  }
  for (const [id, floor] of Object.entries(FLOOR)) {
    const row = rows.find((x) => x.id === id);
    assert.ok(row && row.fidelity >= floor, `${id}: ${row && row.fidelity} under ${floor}`);
  }
});

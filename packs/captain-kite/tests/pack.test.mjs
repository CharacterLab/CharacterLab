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

// Scores, measured with the lab's scorer (npm run characterlab -- score) when Chrome is there: each variant stays above the
// floor set from its measured fidelity (about 3 points under it). The floors were measured on macOS, where the
// command line then rendered with Metal; it now renders with SwiftShader on every machine (GL_ARGS in
// lab/scripts/wc-lab.mjs), so the test gives the same scores everywhere. The same drawing scores a little lower on
// SwiftShader: on Chrome 155 on Linux, 8 of the 26 variants were under their Metal floor by 0.2 to 1.7 points (worst
// kite-pose-sit 83.3 under 85) and the mean was 81.4 against the 82.7 the docs gave. RENDERER_TOLERANCE covers that gap
// and nothing more; every floor below is still the one measured on the Mac.
const RENDERER_TOLERANCE = 2;
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
    const env = { ...process.env }; delete env.LAB_GL;   // always the shared renderer, never LAB_GL=native
    const r = spawnSync(process.execPath, ['lab/scripts/wc-lab.mjs', 'score', `--part=${part}`, `--save=${save}`], { cwd: LAB_DIR, encoding: 'utf8', env });
    assert.equal(r.status, 0, r.stderr);
    rows.push(...JSON.parse(await readFile(save, 'utf8')));
  }
  // every variant is checked, and every miss is listed (not only the first)
  const misses = Object.entries(FLOOR).map(([id, floor]) => [id, floor, rows.find((x) => x.id === id)])
    .filter(([, floor, row]) => !(row && row.fidelity >= floor - RENDERER_TOLERANCE))
    .map(([id, floor, row]) => `${id}: ${row ? row.fidelity : 'not scored'} under ${floor} - ${RENDERER_TOLERANCE}`);
  assert.deepEqual(misses, []);
});

// film --zoom=<name>: the pack names its zooms (lab.filmZooms), the filmstrip draws them, and a name it does not know is
// a plain error (it used to size the strip to 0 x 0 and crash in drawImage).
test('the pack names its film zooms: head, face, eyes, mouth', async () => {
  const CharacterLab = await lab(), z = CharacterLab.lab.character('captain-kite').lab.filmZooms;
  for (const name of ['head', 'face', 'eyes', 'mouth']) assert.ok(z[name] && z[name][2] > 0 && z[name][3] > 0, name);
});
test('film --zoom=head draws the head, and an unknown zoom says so', { skip: !existsSync(CHROME) && 'no Chrome to render with', timeout: 120000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kite-film-')), out = join(dir, 'head.png');
  const film = (...a) => spawnSync(process.execPath, ['lab/scripts/wc-lab.mjs', 'film', '--clip=kite-blink', '--frames=4', ...a], { cwd: LAB_DIR, encoding: 'utf8' });
  const ok = film('--zoom=head', `--out=${out}`);
  assert.equal(ok.status, 0, ok.stderr);
  const png = await readFile(out);
  assert.ok(png.readUInt32BE(16) > 200 && png.readUInt32BE(20) > 200, `a ${png.readUInt32BE(16)} x ${png.readUInt32BE(20)} filmstrip`);
  const bad = film('--zoom=nose', `--out=${join(dir, 'nose.png')}`);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /unknown zoom "nose".*head, face, eyes, mouth/);
});

// The rooftop take-off scenario (kite-rooftop.js, lab/scenarios.html): its boots stay on the roof at lift 0 for any
// wind, lift raises them by exactly that much, the shadow shrinks and fades, and the wind moves the flag.
test('the rooftop scenario: boots on the roof at any wind, lift raises them, the shadow shrinks, the flag streams', async () => {
  const CharacterLab = await lab(), S = CharacterLab.scenarios, sc = S.get('kite-rooftop');
  assert.ok(sc && sc.pack === 'captain-kite', 'registered by the pack');
  assert.deepEqual(Object.keys(sc.params), ['wind', 'lift']);
  for (const wind of [0, 0.25, 0.5, 0.75, 1]) {
    const f = S.frame(sc, S.params(sc, { wind }), 0.3), [kite] = f.cast;
    assert.equal(kite.variant.id, 'kite-front');
    assert.ok(Math.abs(kite.gap) < 0.5, `wind ${wind}: soles ${kite.gap} from the roof`);
    assert.ok(f.ops.every((op) => !op.pts || op.pts.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))), `wind ${wind}: finite ops`);
  }
  const at = (lift) => S.frame(sc, S.params(sc, { lift }), 0);
  assert.ok(Math.abs(at(80).cast[0].gap - 80) < 0.5, 'lift 80: 80 units above the roof');
  const shadow = (f) => f.ops.find((op) => op.kind === 'shadow');
  const width = (op) => Math.max(...op.pts.map((q) => q[0])) - Math.min(...op.pts.map((q) => q[0]));
  assert.ok(width(shadow(at(140))) < 0.6 * width(shadow(at(0))) && shadow(at(140)).amt < shadow(at(0)).amt, 'the shadow shrinks and fades');
  const cloth = (wind) => JSON.stringify(S.frame(sc, S.params(sc, { wind }), 0).ops.filter((op) => op.mat && op.mat.ramp && op.mat.ramp[2] === '#0ca09c'));
  assert.notEqual(cloth(0), cloth(1), 'the wind moves the flag');
});

test('the scenarios page draws the rooftop with Kite on the roof and exports a filmstrip', { skip: !existsSync(CHROME) && 'no Chrome to render with', timeout: 120000 }, async (t) => {
  const { createLabServer } = await import('../../../server.mjs');
  const { launchChrome } = await import('../../../lab/scripts/wc-lab.mjs');
  const { once } = await import('node:events');
  const server = createLabServer({ config: { packDirs: [fileURLToPath(new URL('../../', import.meta.url))], mounts: {}, newPacksDir: tmpdir() } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const browser = await launchChrome();
  t.after(async () => { await browser.close(); server.close(); });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/lab/scenarios.html?s=kite-rooftop&wind=0.8`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__labReady, { timeout: 60000 });
  assert.equal(await page.$eval('#name', (el) => el.textContent), 'Rooftop take-off');
  assert.equal(await page.$eval('#msg', (el) => el.hidden), true, 'no error shown');
  assert.match(await page.$eval('#readout', (el) => el.textContent), /kite-front · kite-blink · Roof: soles on the floor/);
  const png = Buffer.from((await page.evaluate(() => window.__scenarios.strip({ src: 'sweep:lift', n: 4 }))).split(',')[1], 'base64');
  assert.ok(png.readUInt32BE(16) > 1000 && png.readUInt32BE(20) > 200, `a ${png.readUInt32BE(16)} x ${png.readUInt32BE(20)} filmstrip`);
  // the canvas shows the scene: sky up top, the roof's face low down
  const px = await page.$eval('#view', (c) => { const g = c.getContext('2d'); const at = (x, y) => [...g.getImageData(x * c.width, y * c.height, 1, 1).data]; return [at(0.05, 0.05), at(0.05, 0.95)]; });
  assert.ok(px[0][2] > px[0][0] + 40, `a blue sky: ${px[0]}`);
  assert.ok(px[1][2] < 160, `the roof's face: ${px[1]}`);
  assert.deepEqual(errors, []);
});

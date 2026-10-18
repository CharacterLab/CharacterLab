import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { checkPack } from '../lab/scripts/lab-vm.mjs';

// The registration API (lab/js/lab-packs.js), the pack loader of the pages (lab/js/lab-loader.js) and the
// check every pack's own tests run (lab/scripts/lab-vm.mjs checkPack). The packs themselves are tested in their
// folders (packs/<id>/tests/); nothing here needs one.
const LAB = new URL('../', import.meta.url);
const PAGES = ['index.html', 'score.html', 'inspect.html', 'anim.html', 'bake.html', 'scenarios.html'];
const plain = (x) => JSON.parse(JSON.stringify(x));

// The pack API in a fresh page-like context; `run` adds a script to the same context.
async function page(extra = {}) {
  const ctx = vm.createContext(Object.assign({ console }, extra));
  ctx.window = ctx;
  const run = async (url, filename) => vm.runInContext(await readFile(url, 'utf8'), ctx, { filename });
  for (const f of ['lab-geom.js', 'wc-gl.js', 'wc-parts.js', 'wc-rig.js', 'wc-anim.js', 'wc-expressions.js', 'lab-packs.js']) await run(new URL(`lab/js/${f}`, LAB), f);
  return { CharacterLab: ctx.CharacterLab, run, ctx };
}
const api = async () => (await page()).CharacterLab;
const part = (id) => ({ id, label: id, variants: [] });

test('every page loads the packs through the loader, after the pack API and before the catalog', async () => {
  for (const name of PAGES) {
    const html = await readFile(new URL(`lab/${name}`, LAB), 'utf8');
    const srcs = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
    const at = (s) => srcs.indexOf(s);
    assert.ok(at('js/lab-packs.js') >= 0 && at('js/lab-loader.js') > at('js/lab-packs.js') && at('js/wc-elements.js') > at('js/lab-loader.js'), `${name}: lab-packs.js, lab-loader.js, wc-elements.js`);
    assert.ok(at('js/lab-scenarios.js') > at('js/lab-packs.js') && at('js/lab-scenarios.js') < at('js/lab-loader.js'), `${name}: lab-scenarios.js before the packs`);
    assert.ok(!srcs.some((s) => s.includes('packs/')), `${name}: no pack script listed by hand`);
  }
});

test('the lab ships only neutral icons; a pack brings its own (pack.json "icon", "icons")', async () => {
  const html = await readFile(new URL('lab/index.html', LAB), 'utf8');
  const symbols = [...html.matchAll(/<symbol id="i-([a-z-]+)"/g)].map((m) => m[1]);
  assert.ok(symbols.includes('figure'), 'the neutral default icon');
  const NEUTRAL = ['figure', 'head', 'eye', 'nose', 'mouth', 'cheeks', 'brow', 'clump', 'fringe', 'strip', 'shell', 'body', 'arm', 'foot',
    'side', 'onion', 'diff', 'wipe', 'blink', 'play', 'pause', 'panel'];
  assert.deepEqual(symbols.filter((s) => !NEUTRAL.includes(s)), [], 'only the neutral set');
  const lab = await readFile(new URL('lab/js/wc-lab.js', LAB), 'utf8');
  assert.match(lab, /\(p\.icons \|\| \{\}\)\[name\] \|\| \(sprite\(name\) \? null : p\.icon\)/);
});

// lab-loader.js in a page-like context: a stub XMLHttpRequest answering /packs.json, and document.write recorded.
async function runLoader(answer) {
  const written = [], warnings = [];
  class XMLHttpRequest {
    open(method, url, async) { this.url = url; this.async = async; }
    send() { if (answer instanceof Error) throw answer; this.status = answer.status ?? 200; this.responseText = JSON.stringify(answer.body ?? answer); }
  }
  const { CharacterLab, run } = await page({ XMLHttpRequest, document: { write: (h) => written.push(h) }, console: { warn: (...a) => warnings.push(a.join(' ')) } });
  await run(new URL('lab/js/lab-loader.js', LAB), 'lab-loader.js');
  return { CharacterLab, written, warnings };
}

test('the loader writes each pack\'s scripts in the manifest\'s order', async () => {
  const { CharacterLab, written, warnings } = await runLoader({ packs: [
    { id: 'pip', label: 'Pip', base: '/packs/pip/', scripts: ['pip-model.js', 'pip.js'] },
    { id: 'moss', label: 'Moss', base: '/packs/moss/', scripts: ['js/moss.js'] }], problems: 0 });
  assert.deepEqual(written, ['<script src="/packs/pip/pip-model.js"></script>', '<script src="/packs/pip/pip.js"></script>', '<script src="/packs/moss/js/moss.js"></script>']);
  assert.deepEqual(plain(CharacterLab.lab.packs.map((p) => p.id)), ['pip', 'moss']);
  assert.equal(typeof CharacterLab.lab.registerCharacter, 'function', 'the pack API is still there');
  assert.deepEqual(warnings, []);
});

test('the loader writes every pack\'s renderer extensions (*-gl.js) first, so they register before any renderer', async () => {
  const { written } = await runLoader({ packs: [
    { id: 'grain', label: 'Grain', kind: 'materials', base: '/packs/grain/', scripts: ['grain-gl.js'] },
    { id: 'pip', label: 'Pip', base: '/packs/pip/', scripts: ['pip-gl.js', 'pip-model.js', 'pip.js'] },
    { id: 'moss', label: 'Moss', base: '/packs/moss/', scripts: ['moss.js', 'moss-gl.js'] }], problems: 0 });
  assert.deepEqual(written.map((w) => w.match(/src="([^"]+)"/)[1]),
    ['/packs/grain/grain-gl.js', '/packs/pip/pip-gl.js', '/packs/moss/moss-gl.js', '/packs/pip/pip-model.js', '/packs/pip/pip.js', '/packs/moss/moss.js']);
});

test('the loader skips a pack with an unsafe base or script, and loads nothing without a manifest', async () => {
  const { written } = await runLoader({ packs: [
    { id: 'a', base: 'https://evil.example/', scripts: ['a.js'] }, { id: 'b', base: '/packs/b/', scripts: ['../x.js'] },
    { id: 'c', base: '/packs/c/', scripts: ['c.js" onload="x'] }, { id: 'd', base: '/packs/d/', scripts: ['d.js'] }], problems: 2 });
  assert.deepEqual(written, ['<script src="/packs/d/d.js"></script>']);
  for (const answer of [{ status: 404, body: {} }, new Error('offline')]) {
    const r = await runLoader(answer);
    assert.deepEqual(r.written, []);
    assert.deepEqual(plain(r.CharacterLab.lab.packs), []);
    assert.match(r.warnings.join('\n'), /no character packs loaded/);
  }
});

// A pack on disk for checkPack: pack.json and one script.
async function fixturePack(id, manifest, script) {
  const root = await mkdtemp(join(tmpdir(), 'lab-pack-')), dir = join(root, id);
  await mkdir(dir);
  await writeFile(join(dir, 'pack.json'), JSON.stringify(Object.assign({ id, label: 'Pip', version: '0.1.0', license: 'CC0-1.0', scripts: ['pip.js'], sheetsBase: '/packs/pip/' }, manifest)));
  if (script != null) await writeFile(join(dir, 'pip.js'), script);
  return dir;
}
const PIP = 'CharacterLab.lab.registerCharacter({ id: "pip", label: "Pip", sheetsBase: "/packs/pip/", sheets: { "pip-front": { file: "front.png", name: "front" } }, parts: [{ id: "pip", label: "Whole", variants: [] }] });';

test('checkPack takes a materials pack: renderer extensions only, no character, its requirements loaded first', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lab-mat-'));
  const write = async (id, manifest, files) => {
    await mkdir(join(root, id));
    await writeFile(join(root, id, 'pack.json'), JSON.stringify(Object.assign({ id, label: id, version: '0.1.0', kind: 'materials', scripts: Object.keys(files) }, manifest)));
    for (const [f, src] of Object.entries(files)) await writeFile(join(root, id, f), src);
  };
  const MAT = (id, req = []) => `CharacterLab.wcGL.registerMaterial({ id: "${id}", requires: ${JSON.stringify(req)}, glsl: { decl: "float ${id.replace('-', '_')}() { return 1.0; }" } });`;
  await write('grain', {}, { 'grain-gl.js': MAT('grain') });
  await write('moss', { requires: ['grain'] }, { 'moss-gl.js': MAT('moss', ['grain']) });
  await write('lonely', {}, { 'lonely-gl.js': MAT('lonely', ['grain']) });
  await write('sly', {}, { 'sly-gl.js': MAT('sly') + 'CharacterLab.lab.registerCharacter({ id: "sly", label: "Sly", parts: [{}] });' });
  await write('plain', {}, { 'plain-gl.js': '' });
  assert.deepEqual([...await checkPack(join(root, 'grain'))], ['grain']);
  assert.deepEqual([...await checkPack(join(root, 'moss'))], ['moss'], 'its requirement loads first, and is not its own');
  await assert.rejects(checkPack(join(root, 'lonely')), /requires "grain", which is not registered/);
  await assert.rejects(checkPack(join(root, 'sly')), /registers no character/);
  await assert.rejects(checkPack(join(root, 'plain')), /registers no renderer extension/);
  await write('mixed', { scripts: ['mixed.js'] }, { 'mixed.js': '' });
  await assert.rejects(checkPack(join(root, 'mixed')), /only renderer extensions/);
});

test('checkPack accepts a well-formed pack and names what is wrong with a broken one', async () => {
  const def = await checkPack(await fixturePack('pip', {}, PIP));
  assert.equal(def.id, 'pip');
  await assert.rejects(checkPack(await fixturePack('pip', { label: 'Pippa' }, PIP)), /registers pip "Pip", its pack.json says pip "Pippa"/);
  await assert.rejects(checkPack(await fixturePack('pip', { sheetsBase: '/elsewhere/' }, PIP)), /sheetsBase/);
  await assert.rejects(checkPack(await fixturePack('pip', {}, '// registers nothing')), /never call CharacterLab.lab.registerCharacter/);
  await assert.rejects(checkPack(await fixturePack('pip', {}, null)), /ENOENT/);
  await assert.rejects(checkPack(await fixturePack('pip', { scripts: ['../x.js'] }, PIP)), /bad script path/);
  await assert.rejects(checkPack(await fixturePack('moss', {}, PIP)), /id "moss"|registers pip/);
});

test('registerCharacter adds the character, its sheets and its parts', async () => {
  const CharacterLab = await api();
  CharacterLab.lab.registerCharacter({ id: 'pip', label: 'Pip', icon: 'mushroom', sheetsBase: '/sheets/pip/',
    sheets: { 'pip-front': { file: 'front.png', name: 'pip front sheet' } },
    parts: [part('pip'), () => [part('pip-face'), part('pip-feet')], Object.assign(part('shared'), { character: 'other' })],
    masks: { 'pip-front': [[0, 0, 4, 4]] } });
  assert.deepEqual(plain(CharacterLab.WC_CHARACTERS), [{ id: 'pip', label: 'Pip', icon: 'mushroom' }]);
  assert.deepEqual(plain(CharacterLab.WC_EXTRA_SHEETS), { 'pip-front': { file: '/sheets/pip/front.png', name: 'pip front sheet' } });
  const parts = CharacterLab.WC_EXTRA_PARTS.flatMap((p) => (typeof p === 'function' ? p({}) : [p]));
  assert.deepEqual(plain(parts.map((p) => [p.id, p.character])), [['pip', 'pip'], ['pip-face', 'pip'], ['pip-feet', 'pip'], ['shared', 'other']]);
  assert.deepEqual(plain(CharacterLab.WC_EXTRA_MASKS), { 'pip-front': [[0, 0, 4, 4]] });
  assert.deepEqual(plain(CharacterLab.lab.characterIds()), ['pip']);
});

test('registerCharacter keeps what the engine registered before it', async () => {
  const CharacterLab = await api();
  const expr = part('expressions');
  CharacterLab.WC_EXTRA_PARTS = [expr];
  CharacterLab.lab.registerCharacter({ id: 'pip', label: 'Pip', parts: [part('pip')] });
  assert.equal(CharacterLab.WC_EXTRA_PARTS[0], expr);
  assert.equal(CharacterLab.WC_EXTRA_PARTS.length, 2);
});

test('registerCharacter refuses a bad definition', async () => {
  const CharacterLab = await api();
  const reg = (d) => () => CharacterLab.lab.registerCharacter(d);
  assert.throws(reg(null), /needs a character definition/);
  assert.throws(reg({ id: 'Pip', label: 'Pip', parts: [part('a')] }), /bad id/);
  assert.throws(reg({ id: 'pip', label: 'Pip', parts: [part('a')], masks: { 'pip-a': [[0, 0, 1]] } }), /needs \[x0, y0, x1, y1\] boxes/);
  assert.throws(reg({ id: 'pip', parts: [part('a')] }), /needs a label/);
  assert.throws(reg({ id: 'pip', label: 'Pip', parts: [] }), /at least one part/);
  assert.throws(reg({ id: 'pip', label: 'Pip', parts: [part('a')], sheets: { front: { file: 'f.png', name: 'f' } } }), /must start with "pip-"/);
  assert.throws(reg({ id: 'pip', label: 'Pip', parts: [part('a')], sheets: { 'pip-front': { file: 'f.png' } } }), /needs a file and a name/);
  assert.throws(reg({ id: 'pip', label: 'Pip', parts: [42] }), /part 0 is not a part/);
  CharacterLab.lab.registerCharacter({ id: 'pip', label: 'Pip', parts: [part('a')] });
  assert.throws(reg({ id: 'pip', label: 'Pip', parts: [part('a')] }), /registered twice/);
});

test('registerCharacter takes a face, a rig, clips and the lab settings, and the engine reads them', async () => {
  const CharacterLab = await api();
  const build = (p) => ({ ops: [], world: [10, 10], p });
  CharacterLab.lab.registerCharacter({ id: 'pip', label: 'Pip', parts: [part('pip')],
    expressions: { presets: { neutral: { label: 'Neutral', p: { mouth: 'o' } }, happy: { label: 'Happy', p: { mouth: 'grin' } } },
      mouths: { o: 'O', grin: 'Grin' }, build, sliders: [['beam', 'Beam', 0, 1]], rest: { lid: 0, beam: 0 } },
    rig: { parts: ['body', 'cap'] },
    clips: [{ id: 'pip-bob', dur: 1, p: { lid: [[0, 0], [1, 1]] }, pose: { cap: { dy: [[0, 0], [1, -2]] } } }],
    lab: { zooms: { front: { full: [0, 0, 10, 10] } }, layers: ['cap'], follow: { centre: [5, 5], reach: 4, layer: () => ({ p: {}, pose: {} }) } },
    sheetUrl: (file) => (file.startsWith('pip-') ? `/sheets/pip/${file}` : null) });
  const X = CharacterLab.wcExpressions;
  assert.deepEqual(plain(X.params('happy', { lid: 1 })), { mouth: 'grin', lid: 1 });
  assert.deepEqual(plain(X.params('nope')), { mouth: 'o' }, 'an unknown preset is the neutral one');
  assert.deepEqual(plain(X.mouths), { o: 'O', grin: 'Grin' });
  assert.equal(X.build({ lid: 1 }).p.lid, 1);
  assert.deepEqual(plain(X.rest), { lid: 0, beam: 0 });
  assert.deepEqual(plain(CharacterLab.wcAnim.PARTS), ['body', 'cap']);
  assert.equal(CharacterLab.wcAnim.clips['pip-bob'].character, 'pip');
  assert.equal(CharacterLab.wcAnim.clips['pip-bob'].usesLids, true);
  assert.deepEqual(plain(CharacterLab.wcAnim.sample('pip-bob', 0).p), {}, 'a param at its rest value is left out of the frame');
  assert.equal(CharacterLab.lab.firstWith('lab').id, 'pip');
  assert.equal(CharacterLab.lab.sheetUrl('pip-front.png'), '/sheets/pip/pip-front.png');
  assert.equal(CharacterLab.lab.sheetUrl('/abs/a.png'), '/abs/a.png');
  assert.equal(CharacterLab.lab.sheetUrl('other.png'), 'other.png');
});

test('registerCharacter refuses a bad face, rig, clip or lab settings, and registers nothing then', async () => {
  const CharacterLab = await api();
  const reg = (extra) => () => CharacterLab.lab.registerCharacter(Object.assign({ id: 'pip', label: 'Pip', parts: [part('a')] }, extra));
  assert.throws(reg({ expressions: { presets: { a: { p: {} } } } }), /needs a label and params p/);
  assert.throws(reg({ expressions: { presets: {}, build: 1 } }), /expressions.build must be a function/);
  assert.throws(reg({ expressions: { presets: {}, sliders: [['a', 'A', 0]] } }), /sliders must be/);
  assert.throws(reg({ rig: { parts: [] } }), /rig needs a list of part names/);
  assert.throws(reg({ clips: [{ id: 'x' }] }), /needs an id and dur > 0/);
  assert.throws(reg({ clips: [{ id: 'x', dur: 1 }, { id: 'x', dur: 1 }] }), /clip id "x" is taken/);
  assert.throws(reg({ rig: { parts: ['body'] }, clips: [{ id: 'x', dur: 1, pose: { tail: { rot: 1 } } }] }), /moves "tail"/);
  assert.throws(reg({ lab: { zooms: { front: { full: [0, 0, 1] } } } }), /lab.zooms/);
  assert.throws(reg({ lab: { layers: [1] } }), /lab.layers/);
  assert.throws(reg({ sheetUrl: 'x' }), /sheetUrl must be a function/);
  assert.deepEqual(plain(CharacterLab.lab.characterIds()), []);
  assert.equal(CharacterLab.WC_CHARACTERS, undefined);
  assert.deepEqual(Object.keys(CharacterLab.wcAnim.clips), []);
});

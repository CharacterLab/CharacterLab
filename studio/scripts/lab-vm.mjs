// The studio's scripts in a node vm, without a browser, in the pages' order (js/lab-loader.js): the engine, then every
// pack's renderer extensions (*-gl.js), then the packs' other scripts (each pack.json's order), then the catalog. A
// pack's requirements (pack.json "requires") are found next to it and loaded first. The builders only make ops, so
// tests can check them without a GPU (the extensions only register GLSL text).
//   const CharacterLab = await loadLab({ packs: [new URL('../', import.meta.url)] });   // a pack's own tests
//   loadLab({ packs, before, after })   before / after: engine scripts (file names in studio/js/) around the packs
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

const ENGINE_JS = new URL('../js/', import.meta.url);
// The engine scripts every page loads before its packs, and the catalog that reads what they registered.
export const BEFORE = ['lab-geom.js', 'wc-gl.js', 'wc-compare.js', 'wc-parts.js', 'wc-rig.js', 'wc-anim.js', 'wc-expressions.js', 'lab-packs.js'];
export const AFTER = ['wc-elements.js'];
const isGL = (s) => s.endsWith('-gl.js');

const asDir = (dir) => { const u = dir instanceof URL ? dir : pathToFileURL(dir); return u.href.endsWith('/') ? u : new URL(`${u.href}/`); };
const readManifest = async (base) => JSON.parse(await readFile(new URL('pack.json', base), 'utf8'));
export async function packScripts(dir) {
  const base = asDir(dir);
  return (await readManifest(base)).scripts.map((s) => new URL(s, base));
}
// The packs with their requirements (folders next to the pack that requires them) first, each once.
async function withRequirements(dirs) {
  const out = [], seen = new Set();
  const add = async (base, path = []) => {
    if (seen.has(base.href)) return;
    if (path.includes(base.href)) throw new Error(`pack requirements in a circle: ${[...path, base.href].join(' > ')}`);
    const m = await readManifest(base);
    for (const r of m.requires || []) await add(new URL(`../${r}/`, base), [...path, base.href]);
    seen.add(base.href); out.push({ base, scripts: m.scripts });
  };
  for (const d of dirs) await add(asDir(d));
  return out;
}

// onPack(dir, CharacterLab): called before each pack's scripts other than its renderer extensions (a test can wrap the API there).
export async function loadLab({ packs = [], before = BEFORE, after = AFTER, context = {}, onPack = null } = {}) {
  const ctx = vm.createContext(Object.assign({ console }, context));
  ctx.window = ctx;
  const run = async (url) => vm.runInContext(await readFile(url, 'utf8'), ctx, { filename: url.pathname });
  for (const f of before) await run(new URL(f, ENGINE_JS));
  const list = await withRequirements(packs);
  for (const p of list) for (const s of p.scripts.filter(isGL)) await run(new URL(s, p.base));
  for (const p of list) {
    if (onPack) onPack(p.base, ctx.CharacterLab);
    for (const s of p.scripts.filter((x) => !isGL(x))) await run(new URL(s, p.base));
  }
  for (const f of after) await run(new URL(f, ENGINE_JS));
  return ctx.CharacterLab;
}

// What every pack's own tests check (packs/README.md): its pack.json is well formed (lab-config.mjs's rules), its
// scripts exist, and loaded on the engine (after its requirements, and the packs in `with`) a character pack
// registers one character with the manifest's id and label, its sheets under the manifest's sheetsBase (returns the
// definition); a materials pack registers renderer extensions and no character (returns their ids).
export async function checkPack(dir, { with: deps = [] } = {}) {
  const { manifestProblems } = await import('../../lab-config.mjs');
  const base = asDir(dir), manifest = JSON.parse(await readFile(new URL('pack.json', base), 'utf8'));
  const folder = decodeURIComponent(base.pathname.split('/').filter(Boolean).at(-1));
  const problems = manifestProblems(manifest, folder);
  if (problems.length) throw new Error(`${folder}/pack.json: ${problems.join('; ')}`);
  for (const url of await packScripts(base)) await readFile(url);   // throws if a script is missing
  if (manifest.kind === 'materials') {
    const others = (await withRequirements([...deps, base])).filter((p) => p.base.href !== base.href).map((p) => p.base);
    const L0 = await loadLab({ packs: others, after: [] }), before = new Set(L0.wcGL.extensions().map((e) => e.id));
    const L = await loadLab({ packs: [...deps, base], after: [] });
    if (L.lab.characterIds().length > L0.lab.characterIds().length) throw new Error(`${folder}: a materials pack registers no character`);
    const ids = L.wcGL.extensions().map((e) => e.id).filter((id) => !before.has(id));
    if (!ids.length) throw new Error(`${folder}: registers no renderer extension`);
    L.wcGL.fragmentSource();   // throws on a missing or circular requirement
    return ids;
  }
  let def = null;
  const CharacterLab = await loadLab({ packs: [...deps, base], after: [], onPack: (dirUrl, L) => {
    if (dirUrl.href !== base.href) return;
    const register = L.lab.registerCharacter;
    L.lab.registerCharacter = (d) => { def = d; return register(d); };
  } });
  if (!def) throw new Error(`${folder}: its scripts never call CharacterLab.lab.registerCharacter`);
  if (def.id !== manifest.id || def.label !== manifest.label) throw new Error(`${folder}: registers ${def.id} "${def.label}", its pack.json says ${manifest.id} "${manifest.label}"`);
  if ((def.sheetsBase ?? '') !== (manifest.sheetsBase ?? '')) throw new Error(`${folder}: sheetsBase ${JSON.stringify(def.sheetsBase)} is not pack.json's ${JSON.stringify(manifest.sheetsBase)}`);
  const own = Object.keys(def.sheets || {});
  for (const key of own) if (!CharacterLab.WC_EXTRA_SHEETS[key].file.startsWith(manifest.sheetsBase || '')) throw new Error(`${folder}: sheet ${key} is not under ${manifest.sheetsBase}`);
  return def;
}

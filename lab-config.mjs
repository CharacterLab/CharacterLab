// Where the lab finds its character packs and the folders it serves besides its own (node side: server.mjs, the CLI,
// the test runner). Everything is optional:
//   lab.config.json (next to this file)   { "packs": ["../character-packs"], "mounts": { "/sheets/": "../sheets/" } }
//   LAB_PACKS=/a/packs:/b/packs           more pack folders (colon-separated; relative paths are relative to the lab)
// The lab's own packs/ folder is always searched first. A pack folder holds one folder per pack, each with a
// pack.json (packs/README.md). Paths in lab.config.json are relative to the lab folder.
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const LAB_DIR = fileURLToPath(new URL('./', import.meta.url));
const ID = /^[a-z][a-z0-9-]*$/;
// A script a pack lists: a relative .js path inside the pack (no dot segments, no backslashes, plain characters).
const SCRIPT = /^(?!.*(^|\/)\.)[\w./-]+\.js$/;
// An icon a pack ships (pack.json "icon", "icons"): a relative .svg path inside the pack, the same rules.
const SVG = /^(?!.*(^|\/)\.)[\w./-]+\.svg$/;
// A mount prefix: /name/…/ in plain characters, never one of the lab's own paths.
const PREFIX = /^\/[\w-]+(\/[\w.-]+)*\/$/;
const RESERVED = /^\/(lab|studio|packs|api|node_modules)\//;   // /studio/ redirects to /lab/; /api/ is the server's

const asList = (x, what) => {
  if (x == null) return [];
  if (!Array.isArray(x) || !x.every((s) => typeof s === 'string' && s)) throw new Error(`lab.config.json: "${what}" must be a list of paths`);
  return x;
};

// The config: { file, packDirs: [absolute folders, the lab's packs/ first], mounts: { prefix: file URL of a folder } }.
// A missing lab.config.json is an empty one; a broken one is an error (it would silently drop packs otherwise).
export async function readConfig({ labDir = LAB_DIR, env = process.env } = {}) {
  const file = join(labDir, 'lab.config.json');
  let raw = {};
  try { raw = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`lab.config.json: ${error.message}`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('lab.config.json must be an object');
  const fromEnv = (env.LAB_PACKS || '').split(':').filter(Boolean);
  const packDirs = [...new Set([join(labDir, 'packs'), ...asList(raw.packs, 'packs'), ...fromEnv].map((p) => resolve(labDir, p)))];
  const mounts = {};
  if (raw.mounts != null) {
    if (typeof raw.mounts !== 'object' || Array.isArray(raw.mounts)) throw new Error('lab.config.json: "mounts" must map URL prefixes to folders');
    for (const [prefix, dir] of Object.entries(raw.mounts)) {
      if (!PREFIX.test(prefix) || RESERVED.test(prefix)) throw new Error(`lab.config.json: bad mount prefix ${JSON.stringify(prefix)}`);
      if (typeof dir !== 'string' || !dir) throw new Error(`lab.config.json: mount ${prefix} needs a folder`);
      const abs = resolve(labDir, dir);
      mounts[prefix] = pathToFileURL(abs.endsWith(sep) ? abs : abs + sep);
    }
  }
  return { file, packDirs, mounts };
}

// Checks one pack.json; returns a list of problems (empty when it is fine).
export function manifestProblems(m, folder) {
  const out = [];
  if (!m || typeof m !== 'object' || Array.isArray(m)) return ['pack.json is not an object'];
  if (typeof m.id !== 'string' || !ID.test(m.id)) out.push(`bad id ${JSON.stringify(m.id)}`);
  else if (m.id !== folder) out.push(`id "${m.id}" is not its folder's name "${folder}"`);
  if (typeof m.label !== 'string' || !m.label) out.push('needs a label');
  if (!Array.isArray(m.scripts) || !m.scripts.length) out.push('needs at least one script');
  else for (const s of m.scripts) if (typeof s !== 'string' || !SCRIPT.test(s)) out.push(`bad script path ${JSON.stringify(s)}`);
  if (m.order != null && !Number.isFinite(m.order)) out.push('order must be a number');
  if (m.kind != null && !['character', 'materials'].includes(m.kind)) out.push('kind must be "character" or "materials"');
  if (m.kind === 'materials' && Array.isArray(m.scripts) && !m.scripts.every((s) => typeof s === 'string' && isGL(s))) out.push('a materials pack has only renderer extensions (*-gl.js)');
  if (m.icon != null && !(typeof m.icon === 'string' && SVG.test(m.icon))) out.push(`bad icon path ${JSON.stringify(m.icon)}`);
  if (m.icons != null && !(m.icons && typeof m.icons === 'object' && !Array.isArray(m.icons)
    && Object.entries(m.icons).every(([k, v]) => ID.test(k) && typeof v === 'string' && SVG.test(v)))) out.push('icons must map names to .svg paths');
  if (m.requires != null && !(Array.isArray(m.requires) && m.requires.every((r) => typeof r === 'string' && ID.test(r)))) out.push('requires must be a list of pack ids');
  return out;
}

// A renderer extension (CharacterLab.wcGL.registerMaterial / registerMode): every page loads them before the other pack scripts.
export const isGL = (script) => script.endsWith('-gl.js');

const isDir = async (p) => (await stat(p).catch(() => null))?.isDirectory() ?? false;

// Every pack in the config's folders, in load order: by "order" (packs without one last), then folder, then id, each
// after the packs it requires (pack.json "requires": ["<pack id>"]).
// Returns { packs: [{ id, label, dir, base, scripts, order, manifest }], problems: [text] }. A pack with a broken
// pack.json, or an id another folder already gave, is left out and named in problems.
export async function findPacks(config) {
  const packs = [], problems = [], seen = new Map();
  for (const [rank, root] of config.packDirs.entries()) {
    if (!(await isDir(root))) { if (rank > 0) problems.push(`${root}: no such pack folder`); continue; }
    const entries = (await readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name).sort();
    for (const folder of entries) {
      const dir = join(root, folder);
      let m;
      try { m = JSON.parse(await readFile(join(dir, 'pack.json'), 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') problems.push(`${dir}/pack.json: ${error.message}`); continue; }
      const bad = manifestProblems(m, folder);
      if (bad.length) { problems.push(`${dir}: ${bad.join('; ')}`); continue; }
      if (seen.has(m.id)) { problems.push(`${dir}: pack "${m.id}" is already loaded from ${seen.get(m.id)}`); continue; }
      seen.set(m.id, dir);
      packs.push({ id: m.id, label: m.label, kind: m.kind || 'character', requires: m.requires || [], dir, base: `/packs/${m.id}/`,
        scripts: m.scripts, order: m.order ?? Infinity, rank, manifest: m });
    }
  }
  packs.sort((a, b) => a.order - b.order || a.rank - b.rank || (a.id < b.id ? -1 : 1));
  return { packs: withRequirements(packs, problems).map(({ rank, ...p }) => p), problems };
}

// The packs, each moved after the ones it requires (otherwise in the order given); a pack whose requirement is missing,
// or that requires itself through others, is left out and named in problems (and so are the packs requiring it).
function withRequirements(packs, problems) {
  const byId = new Map(packs.map((p) => [p.id, p])), out = [], state = new Map();   // state: 1 visiting, 2 placed, 3 out
  const visit = (p, path) => {
    if (state.get(p.id) === 2) return true;
    if (state.get(p.id) === 3) return false;
    if (state.get(p.id) === 1) { problems.push(`${p.dir}: requires itself through ${[...path, p.id].join(' > ')}`); return false; }
    state.set(p.id, 1);
    for (const r of p.requires) {
      const q = byId.get(r);
      if (!q) { problems.push(`${p.dir}: requires pack "${r}", which was not found`); state.set(p.id, 3); return false; }
      if (!visit(q, [...path, p.id])) { if (state.get(p.id) !== 3) problems.push(`${p.dir}: requires "${r}", which was left out`); state.set(p.id, 3); return false; }
    }
    state.set(p.id, 2); out.push(p); return true;
  };
  for (const p of packs) visit(p, []);
  return out;
}

// What GET /packs.json answers: each pack's id, label, kind, served base and scripts (no paths on disk).
export const publicManifest = ({ packs, problems }) => ({
  packs: packs.map(({ id, label, kind, requires, base, scripts, manifest }) => ({ id, label, kind, requires, version: manifest.version || null, base, scripts,
    icon: manifest.icon || null, icons: manifest.icons || {} })),
  problems: problems.length,   // how many packs were left out (the server prints why; no disk paths go to the page)
});

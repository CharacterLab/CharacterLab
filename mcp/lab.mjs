// The lab the MCP server works on: where it is, its local server (start, status), its command line
// (lab/scripts/wc-lab.mjs) and the extra pack folders this session uses. No dependencies beyond Node.
//   CHARACTER_LAB_DIR   the lab's folder (default: the current folder if it is a Character Lab clone, else this plugin's)
//   LAB_PACKS           more pack folders, colon-separated (as for npm start)
//   PORT                the lab server's port (default 8765)
//   CHARACTER_LAB_PLUGIN=1   set by the plugins' MCP configs: the lab here is a plugin's installed copy
// New characters go to the lab's packs/ in a clone, or to ~/character-lab/characters/ when the lab is a plugin's copy.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile, open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_PORT = 8765;
const CLI = join('lab', 'scripts', 'wc-lab.mjs');
const CLI_TIMEOUT_MS = 10 * 60 * 1000;
const START_TIMEOUT_MS = 15000;

const readJSONSync = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };
export const isLabDir = (dir) => readJSONSync(join(dir, 'package.json'))?.name === 'character-lab' && existsSync(join(dir, 'lab-config.mjs'));
const inside = (dir, parent) => { const r = relative(parent, dir); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };

// The lab's folder: CHARACTER_LAB_DIR, else the current folder when it is a clone, else the plugin's own copy.
// Returns { dir, from: "env" | "cwd" | "plugin" }.
export function findLab({ env = process.env, cwd = process.cwd() } = {}) {
  if (env.CHARACTER_LAB_DIR) {
    const dir = resolve(cwd, env.CHARACTER_LAB_DIR);
    if (!isLabDir(dir)) throw new Error(`CHARACTER_LAB_DIR=${dir} is not a Character Lab folder (no package.json named "character-lab")`);
    return { dir, from: 'env' };
  }
  return isLabDir(cwd) ? { dir: resolve(cwd), from: 'cwd' } : { dir: PLUGIN_ROOT, from: 'plugin' };
}

export function createLab({ env = process.env, cwd = process.cwd() } = {}) {
  const { dir, from } = findLab({ env, cwd });
  const port = Number(env.PORT || DEFAULT_PORT);
  // A plugin's installed copy is replaced on every update, so new characters go to one folder in the user's home
  // instead, which every session finds; a clone the user works in keeps them in its packs/. The plugins' MCP configs
  // set CHARACTER_LAB_PLUGIN=1 (Codex starts the server in the plugin's folder, so its cwd looks like a clone).
  const pluginCopy = dir === PLUGIN_ROOT && (from === 'plugin' || env.CHARACTER_LAB_PLUGIN === '1');
  const installed = pluginCopy || !existsSync(join(dir, '.git'));
  const defaultPacksDir = installed ? join(env.HOME || homedir(), 'character-lab', 'characters') : join(dir, 'packs');
  const extraPacks = new Set((env.LAB_PACKS || '').split(':').filter(Boolean).map((p) => resolve(dir, p)));
  if (installed && existsSync(defaultPacksDir)) extraPacks.add(defaultPacksDir);
  const url = (path = '/lab/') => `http://localhost:${port}${path}`;
  const childEnv = () => ({ ...env, LAB_PACKS: [...extraPacks].join(':') });
  const stateFile = join(dir, 'out', 'lab-server.json');
  return { dir, port, installed, defaultPacksDir, extraPacks, url, childEnv, stateFile, cwd };
}

// --- packs ---
const labModule = (lab, path) => import(pathToFileURL(join(lab.dir, path)).href);

export async function findLabPacks(lab) {
  const { findPacks, readConfig } = await labModule(lab, 'lab-config.mjs');
  return findPacks(await readConfig({ labDir: lab.dir, env: lab.childEnv() }));
}

// A pack folder outside the lab's own packs/: remembered for this session, and, in a clone, listed in lab.config.json
// (git-ignored) so `npm start` and `npm test` find it too. Returns a note for the user, or null.
export async function addPackFolder(lab, folder) {
  if (inside(folder, join(lab.dir, 'packs'))) return null;
  lab.extraPacks.add(folder);
  if (lab.installed) return null;
  const file = join(lab.dir, 'lab.config.json');
  let config = {};
  try { config = JSON.parse(await readFile(file, 'utf8')); } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`lab.config.json could not be read: ${error.message}`);
  }
  const packs = Array.isArray(config.packs) ? config.packs : [];
  if (packs.some((p) => resolve(lab.dir, p) === folder)) return null;
  await writeFile(file, JSON.stringify({ ...config, packs: [...packs, folder] }, null, 2) + '\n');
  return `Added ${folder} to lab.config.json so the lab always finds it.`;
}

// Every character the lab finds, with its parts, variants and clips (loaded in a vm, no browser).
export async function listCharacters(lab) {
  const { packs, problems } = await findLabPacks(lab);
  const characters = packs.filter((p) => p.kind !== 'materials').map((p) => ({ id: p.id, label: p.label, dir: p.dir,
    license: p.manifest.license || null, url: lab.url(`/lab/?char=${p.id}`) }));
  const notes = [...problems];
  let loadLab;
  try { ({ loadLab } = await labModule(lab, 'lab/scripts/lab-vm.mjs')); } catch (error) { notes.push(`could not load the engine: ${error.message}`); }
  if (loadLab) {
    for (const c of characters) {
      try { Object.assign(c, describe(await loadLab({ packs: [c.dir] }), c.id)); }
      catch (error) { notes.push(`${c.id}: ${error.message}`); }
    }
  }
  return { characters, notes };
}

function describe(CL, id) {
  const parts = CL.wcElements.parts.filter((p) => p.character === id)
    .map((p) => ({ id: p.id, label: p.label, variants: p.variants.map((v) => v.id) }));
  const clips = Object.values(CL.wcAnim.clips).filter((c) => c.character === id).map((c) => c.id);
  const def = CL.lab.character(id);
  const expressions = def && def.expressions && def.expressions.presets ? Object.keys(def.expressions.presets) : [];
  return { parts, clips, expressions };
}

// --- the lab server ---
export async function serverStatus(lab) {
  try {
    const res = await fetch(`http://127.0.0.1:${lab.port}/packs.json`, { signal: AbortSignal.timeout(1500) });
    const body = await res.json().catch(() => null);
    if (res.ok && body && Array.isArray(body.packs)) return { running: true, lab: true, packs: body.packs.map((p) => p.id) };
    return { running: true, lab: false, packs: [] };
  } catch {
    return { running: false, lab: false, packs: [] };
  }
}

const readState = async (lab) => { try { return JSON.parse(await readFile(lab.stateFile, 'utf8')); } catch { return null; } };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

async function waitFor(check, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

async function spawnServer(lab) {
  await mkdir(dirname(lab.stateFile), { recursive: true });
  const log = await open(join(lab.dir, 'out', 'lab-server.log'), 'a');
  const child = spawn(process.execPath, ['server.mjs'], { cwd: lab.dir, env: { ...lab.childEnv(), PORT: String(lab.port) },
    detached: true, stdio: ['ignore', log.fd, log.fd] });
  child.unref();
  await log.close();
  await writeFile(lab.stateFile, JSON.stringify({ pid: child.pid, port: lab.port, packs: [...lab.extraPacks] }) + '\n');
  if (!(await waitFor(async () => (await serverStatus(lab)).lab, START_TIMEOUT_MS))) {
    throw new Error(`the lab server did not start; see ${join(lab.dir, 'out', 'lab-server.log')}`);
  }
}

// Starts the lab server if it is not running (or restarts the one these tools started, when it does not see a pack
// it should). want: a pack id that must be served. Returns { url, started, note }.
export async function ensureServer(lab, { want = null } = {}) {
  let status = await serverStatus(lab);
  if (status.running && !status.lab) throw new Error(`port ${lab.port} is taken by another program; set PORT to use another one`);
  if (status.lab && want && !status.packs.includes(want)) {
    const state = await readState(lab);
    if (state && state.port === lab.port && alive(state.pid)) {
      process.kill(state.pid);
      await waitFor(async () => !(await serverStatus(lab)).running, 5000);
      status = await serverStatus(lab);
    } else {
      return { url: lab.url(), started: false, note: `A lab server is already running but does not show "${want}". Stop it, then call lab_start again.` };
    }
  }
  if (status.lab) return { url: lab.url(), started: false, note: null };
  await spawnServer(lab);
  return { url: lab.url(), started: true, note: null };
}

// --- the command line ---
export async function ensureDeps(lab) {
  if (existsSync(join(lab.dir, 'node_modules', 'puppeteer-core'))) return false;
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  await run(npm, ['ci', '--no-audit', '--no-fund'], { cwd: lab.dir, env: process.env, shell: process.platform === 'win32' });
  return true;
}

function run(cmd, args, { cwd, env, shell = false }) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(cmd, args, { cwd, env, shell, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => child.kill(), CLI_TIMEOUT_MS);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return resolveRun({ out, err });
      reject(new Error(friendly(err.trim() || out.trim() || `${cmd} exited with code ${code}`)));
    });
  });
}

function friendly(message) {
  if (/executablePath|Browser was not found|Failed to launch the browser/i.test(message)) {
    return 'Google Chrome was not found. Install Chrome (or Chromium), or set CHROME to its path, then try again.\n' + message.split('\n')[0];
  }
  return message.split('\n').slice(-12).join('\n');
}

export async function runCli(lab, args) {
  await ensureDeps(lab);
  if (!existsSync(join(lab.dir, CLI))) throw new Error(`${join(lab.dir, CLI)} is missing: is this a Character Lab folder?`);
  return run(process.execPath, [CLI, ...args], { cwd: lab.dir, env: lab.childEnv() });
}

export async function scoreRows(lab, { v = null, part = null } = {}) {
  const { out } = await runCli(lab, ['score', '--json', ...(v ? [`--v=${v}`] : part ? [`--part=${part}`] : [])]);
  const start = out.indexOf('[');
  if (start < 0) throw new Error(`the scorer printed no results:\n${out.slice(-500)}`);
  return JSON.parse(out.slice(start));
}

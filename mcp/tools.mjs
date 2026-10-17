// The MCP tools: their schemas (what tools/list answers) and handlers. Each handler checks its arguments and returns
// MCP content blocks; a ToolError is shown to the agent as a tool error with its message.
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { addPackFolder, ensureServer, listCharacters, runCli, scoreRows, serverStatus } from './lab.mjs';

export class ToolError extends Error {}
const ID = /^[a-z][a-z0-9-]*$/;
const MAX_IMAGES = 12;
const MAX_NAME = 80;
const MAX_INLINE_IMAGE = 8 * 1024 * 1024;   // bytes: a bigger PNG is returned as a path only

const text = (t) => ({ type: 'text', text: t });
const json = (value) => text(JSON.stringify(value, null, 2));

// --- argument checks ---
function only(args, keys) {
  if (args == null) return {};
  if (typeof args !== 'object' || Array.isArray(args)) throw new ToolError('arguments must be an object');
  const extra = Object.keys(args).filter((k) => !keys.includes(k));
  if (extra.length) throw new ToolError(`unknown argument(s): ${extra.join(', ')} (expected: ${keys.join(', ') || 'none'})`);
  return args;
}
function idArg(value, what, { optional = false } = {}) {
  if (value == null && optional) return null;
  if (typeof value !== 'string' || !ID.test(value)) throw new ToolError(`${what} must be an id: lowercase letters, digits and dashes, starting with a letter`);
  return value;
}
function boxArg(value) {
  if (value == null) return undefined;
  const box = typeof value === 'string' ? value.split(',').map(Number) : value;
  if (!Array.isArray(box) || box.length !== 4 || box.some((n) => !Number.isFinite(n) || n < 0)) {
    throw new ToolError('box must be [x, y, width, height] in pixels (or "x,y,w,h"), all zero or more');
  }
  if (box[2] === 0 || box[3] === 0) throw new ToolError('box width and height must be more than zero');
  return box.map(Math.round);
}
async function imagesArg(value, cwd) {
  if (!Array.isArray(value) || !value.length) throw new ToolError('images must be a list of one or more PNG file paths');
  if (value.length > MAX_IMAGES) throw new ToolError(`at most ${MAX_IMAGES} images`);
  const files = [];
  for (const p of value) {
    if (typeof p !== 'string' || !p) throw new ToolError('each image must be a file path');
    const file = resolve(cwd, p.replace(/^~(?=\/|$)/, process.env.HOME || '~'));
    const info = await stat(file).catch(() => null);
    if (!info || !info.isFile()) throw new ToolError(`no such file: ${file}`);
    const head = (await readFile(file)).subarray(0, 8).toString('hex');
    if (head !== '89504e470d0a1a0a') throw new ToolError(`${file} is not a PNG; convert it to PNG first`);
    files.push(file);
  }
  return files;
}

// --- helpers ---
const summary = (rows) => {
  const scored = rows.filter((r) => r.fidelity != null);
  const mean = scored.length ? +(scored.reduce((s, r) => s + r.fidelity, 0) / scored.length).toFixed(1) : null;
  return { mean, variants: rows.map((r) => ({ id: r.id, part: r.part, fidelity: r.fidelity ?? null, ...(r.error ? { error: r.error } : {}) })) };
};
async function characterRows(lab, id) {
  const { characters } = await listCharacters(lab);
  const c = characters.find((x) => x.id === id);
  if (!c) throw new ToolError(`no character "${id}"; known: ${characters.map((x) => x.id).join(', ') || 'none'}`);
  const parts = new Set((c.parts || []).map((p) => p.id));
  return (await scoreRows(lab)).filter((r) => parts.has(r.part));
}
async function imageResult(file, caption) {
  const data = await readFile(file);
  const blocks = [text(`${caption}\n${file}`)];
  if (data.length <= MAX_INLINE_IMAGE) blocks.push({ type: 'image', data: data.toString('base64'), mimeType: 'image/png' });
  return blocks;
}
const outFile = (lab, name) => join(lab.dir, 'out', 'mcp', `${name.replace(/[^\w.-]+/g, '_')}.png`);
const lastLine = (out) => out.trim().split('\n').at(-1);
async function packMaker(lab) {
  const file = join(lab.dir, 'lab', 'scripts', 'pack-maker.mjs');
  if (!existsSync(file)) throw new ToolError(`this lab has no ${file}; update the lab (git pull) and try again`);
  return import(pathToFileURL(file).href);
}

// --- the tools ---
export const TOOLS = [
  {
    name: 'lab_start',
    description: 'Start the Character Lab on this computer if it is not running (it installs what it needs the first time) and return the link to give the user.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async run(lab, args) {
      only(args, []);
      const s = await ensureServer(lab);
      return [text(`${s.started ? 'Started' : 'Already running'}: ${s.url}${s.note ? `\n${s.note}` : ''}`)];
    },
  },
  {
    name: 'lab_status',
    description: 'Whether the Character Lab server is running, its link, the lab folder, and the characters it serves.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async run(lab, args) {
      only(args, []);
      const s = await serverStatus(lab);
      return [json({ running: s.lab, url: s.lab ? lab.url() : null, portTakenByAnotherProgram: s.running && !s.lab,
        labDir: lab.dir, newCharactersGoTo: lab.defaultPacksDir, characters: s.packs,
        dependenciesInstalled: existsSync(join(lab.dir, 'node_modules', 'puppeteer-core')) })];
    },
  },
  {
    name: 'list_characters',
    description: 'Every character the lab finds: id, name, folder, link, parts with their variant ids, clips and expressions.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async run(lab, args) {
      only(args, []);
      return [json(await listCharacters(lab))];
    },
  },
  {
    name: 'create_character',
    description: 'Make a new character pack from one or more PNG pictures of the character (the first is the front, full body, on a plain background). '
      + 'Finds the figure on the picture unless box is given, starts the lab, scores the first drawing (a placeholder to improve) and returns the id, folder and link.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The character\'s display name, e.g. "Star Girl".' },
        images: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'PNG file paths; the first is the front view.' },
        id: { type: 'string', description: 'Optional pack id (lowercase, digits, dashes); made from the name if left out.' },
        box: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4,
          description: 'Optional figure box on the first picture: [x, y, width, height] in pixels.' },
        dir: { type: 'string', description: 'Optional folder to make the pack in (e.g. a private characters folder); the lab is set up to find it.' },
        score: { type: 'boolean', description: 'false: only make the pack (no lab start, no first score). Default true.' },
      },
      required: ['name', 'images'],
      additionalProperties: false,
    },
    async run(lab, args) {
      const a = only(args, ['name', 'images', 'id', 'box', 'dir', 'score']);
      if (a.score != null && typeof a.score !== 'boolean') throw new ToolError('score must be true or false');
      if (typeof a.name !== 'string' || !a.name.trim() || a.name.length > MAX_NAME) throw new ToolError(`name must be 1 to ${MAX_NAME} characters`);
      const images = await imagesArg(a.images, lab.cwd), box = boxArg(a.box);
      if (a.dir != null && (typeof a.dir !== 'string' || !a.dir)) throw new ToolError('dir must be a folder path');
      const given = a.id != null ? idArg(a.id, 'id') : null;
      const pm = await packMaker(lab);
      const id = given || pm.slugify(a.name.trim());
      if (!pm.isValidId(id)) throw new ToolError(`"${id}" is not a usable id; pass id`);
      const known = await listCharacters(lab);
      if (known.characters.some((c) => c.id === id)) throw new ToolError(`a character "${id}" already exists; pick another id`);
      const folder = a.dir ? resolve(lab.cwd, a.dir) : lab.defaultPacksDir;
      const sheets = sheetList(images);
      const made = await pm.makePack({ id, label: a.name.trim(), dir: folder, sheets, ...(box ? { box } : {}) });
      const note = await addPackFolder(lab, resolve(made.dir, '..'));
      const server = a.score === false ? null : await ensureServer(lab, { want: id });
      const first = a.score === false ? null : summary(await characterRows(lab, id));
      return [json({ id, dir: made.dir, url: lab.url(`/lab/?char=${id}`), box: made.box, size: made.size, variants: made.variants,
        files: made.files, score: first, notes: [note, server?.note].filter(Boolean),
        next: 'The first drawing is a placeholder. Improve it with the draw-character skill, then call score and compare.' })];
    },
  },
  {
    name: 'score',
    description: 'Score the code drawings against their reference pictures (0 to 100 per variant, and the mean). Give a character id, a variant id, or nothing for every variant.',
    inputSchema: { type: 'object', properties: {
      character: { type: 'string', description: 'A character id from list_characters.' },
      variant: { type: 'string', description: 'One variant id, e.g. "kite-front".' } }, additionalProperties: false },
    async run(lab, args) {
      const a = only(args, ['character', 'variant']);
      const character = idArg(a.character, 'character', { optional: true }), variant = idArg(a.variant, 'variant', { optional: true });
      if (character && variant) throw new ToolError('give character or variant, not both');
      const rows = variant ? await scoreRows(lab, { v: variant }) : character ? await characterRows(lab, character) : await scoreRows(lab);
      if (!rows.length) throw new ToolError(variant ? `no variant "${variant}"; see list_characters` : 'nothing to score');
      return [json(summary(rows))];
    },
  },
  {
    name: 'compare',
    description: 'One picture of a variant: the reference painting | the code drawing | their difference (white where they match, colour where the drawing misses). Returns the image and its path.',
    inputSchema: { type: 'object', properties: { variant: { type: 'string', description: 'A variant id, e.g. "kite-front".' } },
      required: ['variant'], additionalProperties: false },
    async run(lab, args) {
      const variant = idArg(only(args, ['variant']).variant, 'variant');
      const { out } = await runCli(lab, ['sheet', `--v=${variant}`, `--out=${outFile(lab, `compare-${variant}`)}`]);
      return imageResult(lastLine(out), `${variant}: painting | code | difference`);
    },
  },
  {
    name: 'film',
    description: 'A clip\'s frames side by side as one filmstrip picture, to check an animation. Returns the image and its path.',
    inputSchema: { type: 'object', properties: {
      clip: { type: 'string', description: 'A clip id from list_characters, e.g. "kite-wave".' },
      frames: { type: 'integer', minimum: 2, maximum: 48, description: 'How many frames (default 8).' } },
    required: ['clip'], additionalProperties: false },
    async run(lab, args) {
      const a = only(args, ['clip', 'frames']), clip = idArg(a.clip, 'clip');
      if (a.frames != null && !(Number.isInteger(a.frames) && a.frames >= 2 && a.frames <= 48)) throw new ToolError('frames must be a whole number from 2 to 48');
      const { out } = await runCli(lab, ['film', `--clip=${clip}`, ...(a.frames ? [`--frames=${a.frames}`] : []), `--out=${outFile(lab, `film-${clip}`)}`]);
      return imageResult(lastLine(out), `${clip}: filmstrip`);
    },
  },
];

// The pictures as pack sheets: the first is "front", the others named after their files (each name once).
function sheetList(files) {
  const used = new Set();
  return files.map((file, i) => {
    const slug = basename(file, extname(file)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const name = i === 0 ? 'front' : slug && !used.has(slug) ? slug : `sheet-${i + 1}`;
    used.add(name);
    return { name, file };
  });
}

export const toolList = () => TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
export const findTool = (name) => TOOLS.find((t) => t.name === name) || null;

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

// The MCP server (mcp/server.mjs) over stdio, as an agent runs it: initialize, list the tools, call them.
const LAB_DIR = fileURLToPath(new URL('../', import.meta.url));
const SERVER = join(LAB_DIR, 'mcp', 'server.mjs');
const SHEET = join(LAB_DIR, 'examples', 'blob', 'sheets', 'front.png');
const HAS_ENGINE = existsSync(join(LAB_DIR, 'lab', 'scripts', 'lab-vm.mjs'));
const HAS_PACK_MAKER = existsSync(join(LAB_DIR, 'lab', 'scripts', 'pack-maker.mjs'));
const TOOLS = ['lab_start', 'lab_status', 'list_characters', 'create_character', 'score', 'compare', 'film'];

// A client: spawns the server in an empty folder, sends requests, and resolves each by its id.
async function client(env = {}) {
  const cwd = await mkdtemp(join(tmpdir(), 'mcp-cwd-'));
  // Run from an empty folder, the server finds the lab it belongs to and treats it as a plugin's installed copy: it
  // never writes the lab's lab.config.json, and new characters go under HOME (a temporary folder here).
  const env0 = { ...process.env };
  delete env0.CHARACTER_LAB_DIR;
  const child = spawn(process.execPath, [SERVER], { cwd, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...env0, HOME: cwd, PORT: '18765', LAB_PACKS: '', ...env } });
  const waiting = new Map();
  let buf = '', stderr = '', next = 1;
  child.stderr.on('data', (d) => { stderr += d; });
  child.stdout.on('data', (d) => {
    buf += d;
    for (let i; (i = buf.indexOf('\n')) >= 0;) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      const msg = JSON.parse(line);   // stdout must carry protocol messages only
      waiting.get(msg.id)?.(msg); waiting.delete(msg.id);
    }
  });
  const raw = (text) => child.stdin.write(text + '\n');
  const request = (method, params) => new Promise((resolve) => {
    const id = next++; waiting.set(id, resolve);
    raw(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
  });
  const call = async (name, args) => (await request('tools/call', { name, arguments: args })).result;
  const close = () => new Promise((resolve) => { child.on('close', resolve); child.stdin.end(); });
  return { request, call, raw, close, cwd, stderr: () => stderr };
}
const body = (result) => JSON.parse(result.content[0].text);

test('the MCP server answers initialize and lists its tools with schemas', async () => {
  const c = await client();
  try {
    const init = await c.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
    assert.equal(init.result.protocolVersion, '2025-06-18');
    assert.equal(init.result.serverInfo.name, 'character-lab');
    assert.ok(init.result.capabilities.tools);
    c.raw(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));
    const { tools } = (await c.request('tools/list', {})).result;
    assert.deepEqual(tools.map((t) => t.name).sort(), [...TOOLS].sort());
    for (const t of tools) {
      assert.ok(t.description.length > 20, t.name);
      assert.equal(t.inputSchema.type, 'object', t.name);
    }
    assert.deepEqual(tools.find((t) => t.name === 'create_character').inputSchema.required, ['name', 'images']);
    const old = await c.request('initialize', { protocolVersion: '1999-01-01' });
    assert.equal(old.result.protocolVersion, '2025-06-18');
  } finally { await c.close(); }
});

test('the MCP server refuses unknown methods, unknown tools and bad arguments clearly', async () => {
  const c = await client();
  try {
    assert.equal((await c.request('no/such')).error.code, -32601);
    assert.equal((await c.request('tools/call', { name: 'nope', arguments: {} })).error.code, -32602);
    const bad = [
      ['compare', {}, /variant must be an id/],
      ['compare', { variant: '../x' }, /variant must be an id/],
      ['score', { character: 'a', variant: 'b' }, /not both/],
      ['film', { clip: 'kite-wave', frames: 1 }, /frames/],
      ['lab_status', { extra: 1 }, /unknown argument/],
      ['create_character', { images: [SHEET] }, /name must be/],
      ['create_character', { name: 'X', images: [] }, /images must be/],
      ['create_character', { name: 'X', images: [join(c.cwd, 'missing.png')] }, /no such file/],
      ['create_character', { name: 'X', images: [SERVER] }, /not a PNG/],
      ['create_character', { name: 'X', images: [SHEET], box: [1, 2, 3] }, /box must be/],
      ['create_character', { name: 'X', images: [SHEET], id: 'Bad Id' }, /id must be an id/],
    ];
    for (const [name, args, message] of bad) {
      const r = await c.call(name, args);
      assert.equal(r.isError, true, `${name} ${JSON.stringify(args)}`);
      assert.match(r.content[0].text, message);
    }
    c.raw('{not json');
  } finally { await c.close(); }
});

test('lab_status says where the lab is, and list_characters finds Captain Kite', async () => {
  const c = await client();
  try {
    const status = body(await c.call('lab_status', {}));
    assert.equal(status.labDir.replace(/\/$/, ''), LAB_DIR.replace(/\/$/, ''));
    assert.equal(typeof status.running, 'boolean');
    const { characters } = body(await c.call('list_characters', {}));
    const kite = characters.find((x) => x.id === 'captain-kite');
    assert.ok(kite, 'captain-kite is listed');
    assert.equal(kite.url, 'http://localhost:18765/lab/?char=captain-kite');
    if (HAS_ENGINE) {
      assert.ok(kite.parts.some((p) => p.variants.includes('kite-front')));
      assert.ok(kite.clips.includes('kite-wave'));
    }
  } finally { await c.close(); }
});

test('create_character makes a pack in a given folder from a picture', { skip: !HAS_PACK_MAKER && 'needs lab/scripts/pack-maker.mjs' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mcp-packs-'));
  const c = await client();
  try {
    const made = body(await c.call('create_character', { name: 'Test Blob', images: [SHEET], box: [96, 96, 320, 320], dir, score: false }));
    assert.equal(made.id, 'test-blob');
    assert.equal(made.dir, join(dir, 'test-blob'));
    assert.equal(made.url, 'http://localhost:18765/lab/?char=test-blob');
    const manifest = JSON.parse(await readFile(join(made.dir, 'pack.json'), 'utf8'));
    assert.equal(manifest.label, 'Test Blob');
    const { characters } = body(await c.call('list_characters', {}));
    assert.ok(characters.some((x) => x.id === 'test-blob'), 'the new pack is found in this session');
    const again = await c.call('create_character', { name: 'Test Blob', images: [SHEET], dir, score: false });
    assert.equal(again.isError, true);
    assert.match(again.content[0].text, /already exists/);
  } finally { await c.close(); }
});

test('the MCP server stops with a clear message when CHARACTER_LAB_DIR is not a lab', async () => {
  const notLab = await mkdtemp(join(tmpdir(), 'not-a-lab-'));
  const child = spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, CHARACTER_LAB_DIR: notLab } });
  let stderr = '', stdout = '';
  child.stderr.on('data', (d) => { stderr += d; });
  child.stdout.on('data', (d) => { stdout += d; });
  const code = await new Promise((resolve) => child.on('close', resolve));
  assert.equal(code, 1);
  assert.equal(stdout, '');
  assert.match(stderr, /not a Character Lab folder/);
});

test('new characters go to the packs/ of a clone, and to ~/character-lab/characters for a plugin copy', async () => {
  const { createLab } = await import('../mcp/lab.mjs');
  const home = await mkdtemp(join(tmpdir(), 'mcp-home-'));
  const fromPlugin = createLab({ env: { HOME: home }, cwd: home });
  assert.equal(fromPlugin.dir.replace(/\/$/, ''), LAB_DIR.replace(/\/$/, ''));
  assert.equal(fromPlugin.installed, true);
  assert.equal(fromPlugin.defaultPacksDir, join(home, 'character-lab', 'characters'));
  if (existsSync(join(LAB_DIR, '.git'))) {
    const clone = createLab({ env: { HOME: home }, cwd: LAB_DIR });
    assert.equal(clone.installed, false);
    assert.equal(clone.defaultPacksDir, join(LAB_DIR, 'packs'));
  }
  assert.throws(() => createLab({ env: { CHARACTER_LAB_DIR: home }, cwd: home }), /not a Character Lab folder/);
});

test('a plugin starts the server in its own folder: still a plugin copy, not a clone', async () => {
  const { createLab } = await import('../mcp/lab.mjs');
  const home = await mkdtemp(join(tmpdir(), 'mcp-home-'));
  const lab = createLab({ env: { HOME: home, CHARACTER_LAB_PLUGIN: '1' }, cwd: LAB_DIR });
  assert.equal(lab.installed, true);
  assert.equal(lab.defaultPacksDir, join(home, 'character-lab', 'characters'));
});

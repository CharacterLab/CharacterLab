import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The plugin manifests (Agent Plugins, Claude Code, Codex), the MCP configs and the Agent Skills: valid JSON, the
// fields each tool reads, paths that exist, and one name and version everywhere.
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const json = async (path) => JSON.parse(await readFile(join(ROOT, path), 'utf8'));
const NAME = 'character-lab';
const REPO = 'https://github.com/CharacterLab/CharacterLab';
const inRoot = (path) => typeof path === 'string' && path.startsWith('./') && !path.split('/').includes('..') && existsSync(join(ROOT, path));

test('plugin.json follows the Agent Plugins schema', async () => {
  const m = await json('plugin.json'), pkg = await json('package.json');
  assert.equal(m.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
  const allowed = ['$schema', 'name', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords', 'extensions'];
  assert.deepEqual(Object.keys(m).filter((k) => !allowed.includes(k)), []);
  assert.match(m.name, /^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/);
  assert.ok(!/--|\.\./.test(m.name));
  assert.equal(m.name, NAME);
  assert.equal(m.version, pkg.version);
  assert.deepEqual(Object.keys(m.author), ['name']);
  assert.equal(m.repository, REPO);
  assert.equal(m.license, pkg.license);
  assert.ok(m.keywords.every((k) => typeof k === 'string'));
});

test('the Claude Code plugin and marketplace manifests', async () => {
  const m = await json('.claude-plugin/plugin.json'), market = await json('.claude-plugin/marketplace.json');
  assert.equal(m.name, NAME);
  assert.equal(m.version, (await json('package.json')).version);
  assert.equal(m.author.name, 'Character Lab');
  for (const key of ['skills', 'mcpServers', 'commands', 'agents']) assert.equal(m[key], undefined, `${key}: the default location is used`);
  assert.equal(market.name, NAME);
  assert.equal(market.owner.name, 'Character Lab');
  assert.equal(market.plugins.length, 1);
  assert.equal(market.plugins[0].name, NAME);
  assert.equal(market.plugins[0].source, './');
  const mcp = await json('.mcp.json');
  assert.equal(mcp.mcpServers[NAME].command, 'node');
  assert.deepEqual(mcp.mcpServers[NAME].args, ['${CLAUDE_PLUGIN_ROOT}/mcp/server.mjs']);
});

test('the Codex plugin manifest, its marketplace and the portable MCP config', async () => {
  const m = await json('.codex-plugin/plugin.json'), market = await json('.agents/plugins/marketplace.json');
  assert.equal(m.name, NAME);
  assert.equal(m.version, (await json('package.json')).version);
  assert.ok(inRoot(m.skills), 'skills');
  const ui = m.interface;
  for (const key of ['displayName', 'shortDescription', 'longDescription', 'developerName', 'category', 'websiteURL']) {
    assert.equal(typeof ui[key], 'string', key);
  }
  assert.equal(ui.displayName, 'Character Lab');
  assert.equal(ui.developerName, 'Character Lab');
  assert.equal(ui.category, 'Design');
  assert.equal(ui.websiteURL, REPO);
  assert.ok(Array.isArray(ui.capabilities) && ui.capabilities.length);
  assert.equal(ui.defaultPrompt.length, 2);
  assert.equal(market.name, NAME);
  const [entry] = market.plugins;
  assert.equal(entry.name, NAME);
  assert.deepEqual(entry.source, { source: 'local', path: './' });
  assert.deepEqual(entry.policy, { installation: 'AVAILABLE', authentication: 'ON_INSTALL' });
  assert.equal(entry.category, 'Design');
  const mcp = await json('mcp.json'), server = mcp.mcpServers[NAME];
  assert.equal(mcp.$schema, 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json');
  assert.equal(server.type, 'stdio');
  assert.match(server.command, /^[\w.-]+$/, 'a bare executable name');
  assert.equal(server.cwd, '${PLUGIN_ROOT}');
  assert.ok(server.args.every((a) => !a.startsWith('./') || inRoot(a)));
});

test('every skill is an Agent Skill: a folder with SKILL.md whose name matches it', async () => {
  const dirs = (await readdir(join(ROOT, 'skills'), { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  for (const want of ['character-lab', 'create-character', 'draw-character', 'animate-character', 'pack-format']) assert.ok(dirs.includes(want), want);
  for (const dir of dirs) {
    const text = await readFile(join(ROOT, 'skills', dir, 'SKILL.md'), 'utf8');
    const front = /^---\n([\s\S]*?)\n---\n/.exec(text);
    assert.ok(front, `${dir}: YAML frontmatter`);
    const field = (k) => (new RegExp(`^${k}: (.+)$`, 'm').exec(front[1]) || [])[1];
    assert.equal(field('name'), dir);
    assert.match(dir, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.ok(dir.length <= 64);
    const description = field('description');
    assert.ok(description && description.length <= 1024, `${dir}: description`);
    assert.ok(!/[<>]/.test(description), `${dir}: no angle brackets in the description`);
    for (const [, link] of text.matchAll(/\]\((references\/[^)]+)\)/g)) assert.ok(existsSync(join(ROOT, 'skills', dir, link)), `${dir}: ${link}`);
    assert.ok(!/\bstudio\b/i.test(text), `${dir}: the product is "the lab"`);
  }
  assert.ok(!existsSync(join(ROOT, '.claude', 'skills', 'add-character')), 'the old skill moved into skills/');
});

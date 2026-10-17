import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { findPacks, publicManifest, readConfig } from '../lab-config.mjs';
import { createLabServer } from '../server.mjs';

// Where the lab finds its packs and extra folders (lab-config.mjs), and how the server serves them: GET /packs.json and
// each pack at /packs/<id>/. Everything here runs on throwaway folders, never on installed packs.
async function tree(files) {
  const root = await mkdtemp(join(tmpdir(), 'lab-config-'));
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return root;
}
test('a pack loads after the packs it requires; one whose requirement is missing is left out', async () => {
  const cast = await tree({
    'grain/pack.json': manifest('grain', { kind: 'materials', scripts: ['grain-gl.js'], order: 50 }),
    'pip/pack.json': manifest('pip', { order: 1, requires: ['grain'] }), 'moss/pack.json': manifest('moss', { order: 2 }),
    'kite/pack.json': manifest('kite', { requires: ['string'] }), 'tail/pack.json': manifest('tail', { requires: ['kite'] }),
    'odd/pack.json': manifest('odd', { kind: 'materials' }), 'bad/pack.json': manifest('bad', { requires: 'grain' }),
    'ico/pack.json': manifest('ico', { icon: '../up.svg' }), 'icos/pack.json': manifest('icos', { icons: { Big: 'big.svg' } }),
  });
  const { packs, problems } = await findPacks({ packDirs: [cast], mounts: {} });
  assert.deepEqual(packs.map((p) => p.id), ['grain', 'pip', 'moss']);
  assert.deepEqual(packs.map((p) => p.kind), ['materials', 'character', 'character']);
  const text = problems.join('\n');
  for (const want of [/requires pack "string", which was not found/, /tail: requires "kite", which was left out/, /only renderer extensions/, /requires must be a list/, /bad icon path/, /icons must map names/]) assert.match(text, want);
  assert.deepEqual(publicManifest({ packs, problems }).packs[1].requires, ['grain']);
});

const manifest = (id, extra = {}) => Object.assign({ id, label: id[0].toUpperCase() + id.slice(1), version: '0.1.0', scripts: [`${id}.js`] }, extra);

test('with no lab.config.json the lab looks in its own packs/ folder only, and mounts nothing', async () => {
  const lab = await tree({ 'README.md': '' });
  const c = await readConfig({ labDir: lab, env: {} });
  assert.deepEqual(c.packDirs, [join(lab, 'packs')]);
  assert.deepEqual(c.mounts, {});
  assert.deepEqual(await findPacks(c), { packs: [], problems: [] }, 'no packs/ folder is not a problem');
});

test('lab.config.json and LAB_PACKS add pack folders (relative to the lab) and mounts', async () => {
  const lab = await tree({ 'lab.config.json': { packs: ['../cast'], mounts: { '/sheets/': '../art/sheets' } } });
  const c = await readConfig({ labDir: lab, env: { LAB_PACKS: `/abs/more:rel/packs:` } });
  assert.deepEqual(c.packDirs, [join(lab, 'packs'), join(lab, '..', 'cast'), '/abs/more', join(lab, 'rel', 'packs')]);
  assert.equal(c.mounts['/sheets/'].href, pathToFileURL(join(lab, '..', 'art', 'sheets') + sep).href);
});

test('a broken lab.config.json is an error, not an empty config', async () => {
  for (const [config, message] of [['{ nope', /lab.config.json/], [{ packs: '../cast' }, /"packs" must be a list/],
    [{ mounts: { 'sheets/': '../x' } }, /bad mount prefix/], [{ mounts: { '/packs/': '../x' } }, /bad mount prefix/],
    [{ mounts: { '/lab/': '../x' } }, /bad mount prefix/], [{ mounts: { '/x/': '' } }, /needs a folder/], [[], /must be an object/]]) {
    const lab = await tree({ 'lab.config.json': typeof config === 'string' ? config : JSON.stringify(config) });
    await assert.rejects(readConfig({ labDir: lab, env: {} }), message, JSON.stringify(config));
  }
});

test('packs load by their order, then by folder, then by id; broken or duplicate ones are left out and named', async () => {
  const own = await tree({
    'packs/zed/pack.json': manifest('zed'), 'packs/moss/pack.json': manifest('moss', { order: 20 }),
    'packs/notes/README.md': 'not a pack',
    'packs/bad/pack.json': '{ broken', 'packs/wrong/pack.json': manifest('right'),
    'packs/sly/pack.json': manifest('sly', { scripts: ['../../server.mjs.js'] }),
  });
  const more = await tree({ 'pip/pack.json': manifest('pip', { order: 10 }), 'zed/pack.json': manifest('zed'), 'ant/pack.json': manifest('ant') });
  const c = { packDirs: [join(own, 'packs'), more, join(more, 'missing')], mounts: {} };
  const { packs, problems } = await findPacks(c);
  assert.deepEqual(packs.map((p) => p.id), ['pip', 'moss', 'zed', 'ant']);
  assert.deepEqual(packs.map((p) => p.base), ['/packs/pip/', '/packs/moss/', '/packs/zed/', '/packs/ant/']);
  assert.equal(packs[2].dir, join(own, 'packs', 'zed'), 'the lab\'s own folder wins a duplicate id');
  const text = problems.join('\n');
  for (const want of [/bad\/pack.json/, /id "right" is not its folder's name "wrong"/, /bad script path/, /pack "zed" is already loaded/, /missing: no such pack folder/]) assert.match(text, want);
  const pub = publicManifest({ packs, problems });
  assert.equal(pub.problems, problems.length);
  assert.ok(!JSON.stringify(pub).includes(own), 'no paths on disk in /packs.json');
  assert.deepEqual(Object.keys(pub.packs[0]).sort(), ['base', 'description', 'icon', 'icons', 'id', 'kind', 'label', 'requires', 'scripts', 'thumb', 'version']);
});

test('new packs go to the lab\'s packs/, or "newPacksDir", or LAB_NEW_PACKS, and that folder is searched too', async () => {
  const lab = await tree({ 'README.md': '' });
  assert.equal((await readConfig({ labDir: lab, env: {} })).newPacksDir, join(lab, 'packs'));
  const configured = await tree({ 'lab.config.json': { newPacksDir: '../made' } });
  const c = await readConfig({ labDir: configured, env: {} });
  assert.equal(c.newPacksDir, join(configured, '..', 'made'));
  assert.deepEqual(c.packDirs, [join(configured, 'packs'), join(configured, '..', 'made')]);
  assert.equal((await readConfig({ labDir: configured, env: { LAB_NEW_PACKS: '/tmp/elsewhere' } })).newPacksDir, '/tmp/elsewhere');
  await assert.rejects(readConfig({ labDir: await tree({ 'lab.config.json': { newPacksDir: 3 } }), env: {} }), /newPacksDir/);
});

test('a pack\'s card picture: pack.json "thumb", else sheets/front.png, else its first sheet', async () => {
  const dir = await tree({
    'a/pack.json': manifest('a', { thumb: 'art/card.webp' }), 'b/pack.json': manifest('b'), 'b/sheets/front.png': '', 'b/sheets/back.png': '',
    'c/pack.json': manifest('c'), 'c/sheets/02-side.png': '', 'c/sheets/01-front.png': '', 'd/pack.json': manifest('d'),
    'e/pack.json': manifest('e', { thumb: '../x.png' }),
  });
  const { packs, problems } = await findPacks({ packDirs: [dir], mounts: {} });
  assert.deepEqual(publicManifest({ packs, problems }).packs.map((p) => [p.id, p.thumb]),
    [['a', '/packs/a/art/card.webp'], ['b', '/packs/b/sheets/front.png'], ['c', '/packs/c/sheets/01-front.png'], ['d', null]]);
  assert.match(problems.join('\n'), /bad thumb path/);
});

// fetch() normalises "..", so traversal probes go through a raw request.
function rawGet(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, headers: { Host: `localhost:${port}` } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject);
    req.end();
  });
}
async function serve(config) {
  const server = createLabServer({ config, mounts: config.mounts });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  return { server, port, base: `http://localhost:${port}` };
}

test('the server lists the packs it found and serves each one read-only at /packs/<id>/', async (t) => {
  const cast = await tree({
    'pip/pack.json': manifest('pip', { order: 1 }), 'pip/pip.js': 'CharacterLab.pip = 1;', 'pip/sheets/front.png': 'PNG', 'pip/tool.html': '<!doctype html><body>tool</body>',
    'pip/tests/pip.test.mjs': 'x', 'pip/scripts/bake.sh': 'x', 'pip/package.json': '{}', 'pip/.secret.js': 'x', 'pip/notes.txt': 'notes',
    'moss/pack.json': manifest('moss', { order: 2 }), 'moss/moss.js': 'CharacterLab.moss = 1;',
  });
  const art = await tree({ 'front.png': 'PNG', 'make.py': 'x' });
  const { server, base, port } = await serve({ packDirs: [cast], mounts: { '/art/': pathToFileURL(art + sep) } });
  t.after(() => server.close());
  const res = await fetch(`${base}/packs.json`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/json/);
  const body = await res.json();
  assert.deepEqual(body.packs.map((p) => [p.id, p.base, p.scripts]), [['pip', '/packs/pip/', ['pip.js']], ['moss', '/packs/moss/', ['moss.js']]]);
  for (const [path, type] of [['/packs/pip/pip.js', /javascript/], ['/packs/pip/sheets/front.png', /image\/png/], ['/packs/moss/moss.js', /javascript/],
    ['/packs/pip/tool.html', /text\/html/], ['/packs/pip/pack.json', /json/], ['/art/front.png', /image\/png/]]) {
    const r = await fetch(`${base}${path}`);
    assert.equal(r.status, 200, path);
    assert.match(r.headers.get('content-type'), type, path);
  }
  assert.equal(await (await fetch(`${base}/packs/pip/tool.html`)).text(), '<!doctype html><body>tool</body>', 'a pack page is served as it is');
  for (const path of ['/packs/pip/tests/pip.test.mjs', '/packs/pip/scripts/bake.sh', '/packs/pip/package.json', '/packs/pip/.secret.js', '/packs/nope/pip.js',
    '/packs/pip/missing.js', '/packs/', '/packs/README.md', '/art/make.py', '/packs/Pip/pip.js']) {
    assert.equal((await fetch(`${base}${path}`, { redirect: 'manual' })).status, 404, path);
  }
  for (const path of ['/packs/pip/../../server.mjs', '/packs/pip/..%2Fmoss%2Fmoss.js', '/packs/pip/..%2F..%2Fmoss%2Fpack.json', '/packs/pip/%2e%2e/%2e%2e/etc/passwd']) assert.equal(await rawGet(port, path), 404, path);
  const folder = await fetch(`${base}/packs/pip/sheets`, { redirect: 'manual' });
  assert.equal(folder.status, 301);
  assert.equal(folder.headers.get('location'), '/packs/pip/sheets/');
});

test('with no packs at all the server answers an empty manifest and the lab page still loads', async (t) => {
  const { server, base } = await serve({ packDirs: [join(await tree({ 'x.txt': '' }), 'packs')], mounts: {} });
  t.after(() => server.close());
  assert.deepEqual(await (await fetch(`${base}/packs.json`)).json(), { packs: [], problems: 0 });
  for (const path of ['/lab/', '/lab/js/lab-loader.js', '/lab/js/wc-lab.js', '/']) assert.equal((await fetch(`${base}${path}`)).status, 200, path);
});

test('the lab shows an empty state when no pack registered a character', async () => {
  const { readFile } = await import('node:fs/promises');
  const js = await readFile(new URL('../lab/js/wc-lab.js', import.meta.url), 'utf8');
  assert.match(js, /if \(!E\.parts\.length\) return empty\(\);/);
  assert.match(js, /No character packs found; see <code>packs\/README\.md<\/code>/);
});

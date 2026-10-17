import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {mkdtemp, mkdir, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createLabServer} from '../server.mjs';

// The lab's server (server.mjs): the home page, the studio, the packs and the mounted folders, on throwaway
// fixtures (a mounted art folder and a pack with a page), so the tests never depend on any pack being installed.
async function makeArtFixture() {
  const dir = await mkdtemp(join(tmpdir(), 'lab-art-'));
  await mkdir(join(dir, 'world'));
  await mkdir(join(dir, '.plugin'));
  await writeFile(join(dir, 'index.html'), '<!doctype html><html><body><h1>Hub</h1></body></html>');
  await writeFile(join(dir, 'world', 'index.html'), '<!doctype html><html><body><canvas></canvas></body></html>');
  await writeFile(join(dir, 'world', 'main.js'), 'export const world = true;');
  await writeFile(join(dir, 'sheet.webp'), 'RIFF');
  await writeFile(join(dir, '.env'), 'SECRET=1');
  await writeFile(join(dir, '.plugin', 'plugin.json'), '{}');
  await writeFile(join(dir, 'render.sh'), 'echo hi');
  await writeFile(join(dir, 'package.json'), '{"name":"art"}');
  await writeFile(join(dir, 'package-lock.json'), '{}');
  return pathToFileURL(`${dir}/`);
}
async function makePacksFixture() {
  const dir = await mkdtemp(join(tmpdir(), 'lab-packs-'));
  await mkdir(join(dir, 'pip'));
  await writeFile(join(dir, 'pip', 'pack.json'), JSON.stringify({id: 'pip', label: 'Pip', version: '0.1.0', scripts: ['pip.js']}));
  await writeFile(join(dir, 'pip', 'pip.js'), '');
  await writeFile(join(dir, 'pip', 'tool.html'), '<!doctype html><html><body><canvas></canvas></body></html>');
  return dir;
}
async function startLab(options = {}) {
  const config = {packDirs: [await makePacksFixture()], mounts: {}};
  const server = createLabServer({mounts: {'/art/': await makeArtFixture()}, config, ...options});
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  return {server, base: `http://localhost:${port}`, port};
}
// fetch() normalises "..", so traversal probes go through a raw request.
function rawGet(port, path, method = 'GET', host = `localhost:${port}`) {
  return new Promise((resolve, reject) => {
    const req = http.request({host: '127.0.0.1', port, path, method, headers: {Host: host}}, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject);
    req.end();
  });
}

test('the home page leads to the studio and its tools', async t => {
  const {server, base} = await startLab();
  t.after(() => server.close());
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  const html = await res.text();
  for (const href of ['studio/', 'studio/score.html', 'studio/anim.html', 'studio/cel.html']) assert.ok(html.includes(`href="${href}"`), `home links to ${href}`);
});

test('the studio pages and a pack\'s page are served as they are', async t => {
  const {server, base} = await startLab();
  t.after(() => server.close());
  for (const path of ['/studio/', '/studio/score.html', '/studio/inspect.html', '/studio/bake.html', '/studio/anim.html', '/studio/cel.html', '/packs/pip/tool.html']) {
    const res = await fetch(`${base}${path}`);
    assert.equal(res.status, 200, path);
    assert.match(res.headers.get('content-type'), /text\/html/, path);
  }
  const js = await fetch(`${base}/studio/js/wc-gl.js`);
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /javascript/);
  const folder = await fetch(`${base}/studio?part=ears`, {redirect: 'manual'});
  assert.equal(folder.status, 301);
  assert.equal(folder.headers.get('location'), '/studio/?part=ears');
});

test('scripts, tests, package files and server code are never served', async t => {
  const {server, base, port} = await startLab();
  t.after(() => server.close());
  for (const path of [
    '/.env', '/.gitignore', '/server.mjs', '/lab-config.mjs', '/lab.config.json', '/lab.config.example.json', '/static-mounts.js', '/README.md', '/LICENSE',
    '/package.json', '/package-lock.json', '/tests/lab.test.mjs', '/node_modules/three/package.json', '/node_modules/puppeteer-core/package.json',
    '/studio/scripts/wc-lab.mjs', '/studio/scripts', '/studio/scripts/', '/studio/tests/wc-lab-cli.test.mjs', '/studio/tests/',
    '/studio/Scripts/wc-lab.mjs', '/studio/%73cripts/wc-lab.mjs', '/studio/TESTS/wc-lab-cli.test.mjs', '/studio/js/', '/studio/js/wc-gl.js/',
  ]) {
    assert.equal((await fetch(`${base}${path}`, {redirect: 'manual'})).status, 404, path);
  }
  for (const path of ['/studio/../server.mjs', '/studio/..%2Fserver.mjs', '/studio/%2e%2e/.env', '/studio/js/..%5C..%5Cserver.mjs', '/packs/pip/..%2F..%2Fpackage.json']) {
    assert.equal(await rawGet(port, path), 404, path);
  }
});

test('mounted assets keep their content type and are not rewritten; a folder without its slash redirects', async t => {
  const {server, base} = await startLab();
  t.after(() => server.close());
  const page = await fetch(`${base}/art/world/`);
  assert.equal(page.status, 200);
  assert.equal(await page.text(), '<!doctype html><html><body><canvas></canvas></body></html>');
  const js = await fetch(`${base}/art/world/main.js`);
  assert.match(js.headers.get('content-type'), /javascript/);
  assert.equal(await js.text(), 'export const world = true;');
  assert.equal((await fetch(`${base}/art/sheet.webp`)).headers.get('content-type'), 'image/webp');
  const res = await fetch(`${base}/art/world`, {redirect: 'manual'});
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), '/art/world/');
});

test('mounted folders never expose dotfiles, scripts or parent folders', async t => {
  const {server, base, port} = await startLab();
  t.after(() => server.close());
  for (const path of ['/art/.env', '/art/.plugin/plugin.json', '/art/render.sh', '/art/missing.html',
    '/art/package.json', '/art/package-lock.json', '/art/PACKAGE.JSON', '/art/package.json/', '/art/world/main.js/']) {
    assert.equal((await fetch(`${base}${path}`)).status, 404, path);
  }
  for (const path of ['/art/../server.mjs', '/art/..%2Fserver.mjs', '/art/%2e%2e/.env', '/art/world/..%2F..%2F.env']) {
    assert.equal(await rawGet(port, path), 404, path);
  }
});

test('a mounted folder (lab.config.json "mounts") serves its own files only, nothing beside it', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'lab-sheets-'));
  await mkdir(join(dir, 'images', 'pip'), {recursive: true});
  await mkdir(join(dir, 'src'));
  await writeFile(join(dir, 'images', 'pip', 'sheet.png'), 'PNG');
  await writeFile(join(dir, 'src', 'characters.js'), 'export {};');
  await writeFile(join(dir, 'design-manifest.json'), '{}');
  const server = createLabServer({config: {packDirs: [], mounts: {}}, mounts: {'/art/studies/images/': pathToFileURL(`${dir}/images/`)}});
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const port = server.address().port, base = `http://localhost:${port}/art/studies`;
  const res = await fetch(`${base}/images/pip/sheet.png`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  for (const path of ['src/characters.js', 'design-manifest.json', 'images/../src/characters.js']) {
    assert.equal(await rawGet(port, `/art/studies/${path}`), 404, path);
  }
});

test('the lab answers only GET and HEAD, and only on localhost', async t => {
  const {server, port} = await startLab();
  t.after(() => server.close());
  assert.equal(await rawGet(port, '/', 'GET', 'evil.example:80'), 403);
  assert.equal(await rawGet(port, '/', 'POST'), 405);
  assert.equal(await rawGet(port, '/', 'HEAD'), 200);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLabServer } from '../server.mjs';
import { MAX_BODY } from '../lab/js/lab-pack-rules.mjs';
import { encodePng } from '../lab/scripts/png.mjs';

// POST /api/characters (lab-api.mjs): the new-character page's request makes a pack in the folder for new packs,
// and /packs.json lists it at once. Everything runs on throwaway folders.
function sheetPng(width = 96, height = 128) {
  const rgba = Buffer.alloc(width * height * 4, 240);
  for (let y = 30; y < 100; y++) for (let x = 30; x < 66; x++) rgba.set([60, 90, 200, 255], (y * width + x) * 4);
  return encodePng({ width, height, rgba });
}
const PNG64 = sheetPng().toString('base64');

async function startLab() {
  const packs = await mkdtemp(join(tmpdir(), 'lab-new-'));
  await mkdir(join(packs, 'pip'));
  await writeFile(join(packs, 'pip', 'pack.json'), JSON.stringify({ id: 'pip', label: 'Pip', scripts: ['pip.js'] }));
  await writeFile(join(packs, 'pip', 'pip.js'), '');
  const server = createLabServer({ config: { packDirs: [packs], mounts: {}, newPacksDir: packs } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://localhost:${server.address().port}`;
  return { server, base, packs };
}
const post = (base, body, headers = {}) => fetch(`${base}/api/characters`, {
  method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body),
  headers: { 'Content-Type': 'application/json', Origin: base, ...headers },
});
const character = (extra = {}) => ({ id: 'star-girl', label: 'Star Girl', sheets: [{ name: 'front', png: PNG64 }], ...extra });

test('a new character is made in the new-packs folder and listed at once', async (t) => {
  const { server, base, packs } = await startLab();
  t.after(() => server.close());
  const res = await post(base, character({ sheets: [{ name: 'front', png: PNG64 }, { name: 'Back', png: PNG64, box: [20, 20, 60, 90] }], box: [24, 24, 48, 82] }));
  assert.equal(res.status, 201, await res.clone().text());
  const made = await res.json();
  assert.equal(made.id, 'star-girl');
  assert.equal(made.url, '/lab/?char=star-girl');
  assert.deepEqual(made.variants.map((v) => [v.id, v.frame]), [['star-girl-front', [24, 24, 48, 82]], ['star-girl-back', [20, 20, 60, 90]]]);
  assert.ok((await readdir(packs)).includes('star-girl'));
  const list = await (await fetch(`${base}/packs.json`)).json();
  const pack = list.packs.find((p) => p.id === 'star-girl');
  assert.equal(pack.label, 'Star Girl');
  assert.equal(pack.thumb, '/packs/star-girl/sheets/front.png');
  assert.equal((await fetch(`${base}${pack.thumb}`)).status, 200, 'its sheet is served');
  assert.equal((await fetch(`${base}/packs/star-girl/star-girl.js`)).status, 200);
});

test('a box left out is found from the picture', async (t) => {
  const { server, base } = await startLab();
  t.after(() => server.close());
  const made = await (await post(base, character({ id: 'auto' }))).json();
  assert.deepEqual(made.variants[0].frame, [26, 26, 44, 78]);
});

test('bad ids, duplicates, non-PNG pictures and bad boxes are refused in plain words', async (t) => {
  const { server, base, packs } = await startLab();
  t.after(() => server.close());
  const cases = [
    [character({ id: 'Star Girl' }), 400, /lowercase letters/],
    [character({ id: '../evil' }), 400, /lowercase letters/],
    [character({ id: 'pip' }), 409, /already a character "pip"/],
    [character({ sheets: [] }), 400, /at least one picture/],
    [character({ sheets: Array(9).fill({ name: 'x', png: PNG64 }) }), 400, /At most 8/],
    [character({ sheets: [{ name: 'front', png: Buffer.from('GIF89a…').toString('base64') }] }), 415, /not a PNG/],
    [character({ sheets: [{ name: 'front', png: 'not base64!' }] }), 400, /base64/],
    [character({ box: [0, 0, 500, 500] }), 400, /crop box/],
    [character({ box: 'all' }), 400, /crop box/],
    [character({ label: 'two\nlines' }), 400, /one line/],
    ['{ nope', 400, /not valid JSON/],
  ];
  for (const [body, status, message] of cases) {
    const res = await post(base, body);
    assert.equal(res.status, status, JSON.stringify(body).slice(0, 80));
    assert.match((await res.json()).error, message);
  }
  assert.deepEqual((await readdir(packs)).sort(), ['pip'], 'nothing was made');
  assert.equal((await post(base, character())).status, 201);
  const again = await post(base, character());
  assert.equal(again.status, 409);
  assert.doesNotMatch((await again.json()).error, new RegExp(packs.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'no disk paths in the answer');
});

test('only the lab\'s own page may post: same Origin, JSON, a body of at most 25 MB', async (t) => {
  const { server, base, packs } = await startLab();
  t.after(() => server.close());
  for (const [headers, status] of [[{ Origin: 'http://evil.example' }, 403], [{ Origin: '' }, 403], [{ Origin: 'http://localhost:1' }, 403],
    [{ 'Sec-Fetch-Site': 'cross-site' }, 403], [{ 'Content-Type': 'text/plain' }, 415], [{ 'Content-Type': 'multipart/form-data; boundary=x' }, 415]]) {
    const res = await post(base, character(), headers);
    assert.equal(res.status, status, JSON.stringify(headers));
    assert.ok((await res.json()).error);
  }
  const big = JSON.stringify(character({ sheets: [{ name: 'front', png: 'A'.repeat(MAX_BODY) }] }));
  const res = await post(base, big);
  assert.equal(res.status, 413);
  assert.match((await res.json()).error, /too big/);
  assert.equal((await fetch(`${base}/api/characters`)).status, 405);
  assert.deepEqual((await readdir(packs)).sort(), ['pip']);
});

test('the API answers on the local host only', async (t) => {
  const { server } = await startLab();
  t.after(() => server.close());
  const port = server.address().port;
  const status = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/api/characters', method: 'POST',
      headers: { Host: 'evil.example', Origin: 'http://evil.example', 'Content-Type': 'application/json' } }, (r) => { r.resume(); resolve(r.statusCode); });
    req.on('error', reject);
    req.end(JSON.stringify(character()));
  });
  assert.equal(status, 403);
});

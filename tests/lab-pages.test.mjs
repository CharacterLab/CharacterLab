import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLabServer } from '../server.mjs';
import { encodePng } from '../lab/scripts/png.mjs';
import { chromePath, launchChrome } from '../lab/scripts/wc-lab.mjs';

// The home page, the lab and the new-character page in headless Chrome, on a throwaway packs folder: each page loads
// without errors, and a character made on the new-character page opens in the lab with its first score.
// Skipped when Chrome is not installed (CHROME=/path/to/chrome).
const skip = existsSync(chromePath()) ? false : `no Chrome at ${chromePath()}`;

function sheet(width = 240, height = 320) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) rgba.set([238, 240, 243, 255], i);
  for (let y = 60; y < 280; y++) for (let x = 70; x < 170; x++) if (((x - 120) / 50) ** 2 + ((y - 170) / 110) ** 2 <= 1) rgba.set([255, 138, 31, 255], (y * width + x) * 4);
  return encodePng({ width, height, rgba });
}

async function startLab() {
  const packs = await mkdtemp(join(tmpdir(), 'lab-pages-'));
  const server = createLabServer({ config: { packDirs: [packs], mounts: {}, newPacksDir: packs } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, packs, base: `http://127.0.0.1:${server.address().port}` };
}

async function open(browser, url, ready) {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewport({ width: 1200, height: 900 });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(ready, { timeout: 60000 });
  return { page, errors };
}

test('the home page, the lab and the new-character page make a character and open it scored', { skip, timeout: 180000 }, async (t) => {
  const { server, packs, base } = await startLab();
  const browser = await launchChrome();
  t.after(async () => { await browser.close(); server.close(); });

  const home = await open(browser, `${base}/`, () => window.__labReady);
  assert.match(await home.page.$eval('#chars', (el) => el.textContent), /No characters yet/);
  assert.equal(await home.page.$eval('#choice-sample', (el) => el.hidden), true, 'no sample pack here: its card is hidden');
  assert.deepEqual(home.errors, []);

  const empty = await open(browser, `${base}/lab/`, () => /no characters/.test(document.title));
  assert.ok(await empty.page.$('#note a[href="new.html"]'), 'an empty lab points to the new-character page');
  assert.deepEqual(empty.errors, []);

  const file = join(packs, '..', `front-${process.pid}.png`);
  await writeFile(file, sheet());
  const { page, errors } = await open(browser, `${base}/lab/new.html`, () => window.__labReady);
  await page.type('#label', 'Test Pal');
  assert.equal(await page.$eval('#id', (el) => el.value), 'test-pal', 'the id follows the name');
  await (await page.$('#files')).uploadFile(file);
  await page.waitForSelector('.sheet.front .box-out');
  assert.equal(await page.$eval('.box-out', (el) => el.textContent), '65, 55 · 110 × 230', 'the box found around the figure');
  // drag the box's bottom-right corner 30 css pixels out, then make the character
  const handle = await page.$('.crop i[data-h=se]');
  await handle.scrollIntoView();
  const at = await handle.boundingBox();
  await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
  await page.mouse.down();
  await page.mouse.move(at.x + at.width / 2 + 30, at.y + at.height / 2 + 30, { steps: 4 });
  await page.mouse.up();
  const moved = await page.$eval('.box-out', (el) => el.textContent);
  assert.notEqual(moved, '65, 55 · 110 × 230', 'the corner resized the box');
  await Promise.all([page.waitForNavigation({ timeout: 60000 }), page.click('#create')]);
  const landed = new URL(page.url());
  assert.equal(landed.pathname, '/lab/');
  assert.equal(landed.searchParams.get('char'), 'test-pal', 'the lab opened on the new character');
  await page.waitForFunction(() => !!window.__wcScore, { timeout: 120000 });
  assert.match(await page.title(), /Test Pal/);
  assert.ok(Number.isFinite((await page.evaluate(() => window.__wcScore)).fidelity), 'the lab scored it');
  assert.deepEqual(errors, []);
  assert.deepEqual(await readdir(packs), ['test-pal']);

  const again = await open(browser, `${base}/`, () => window.__labReady);
  assert.match(await again.page.$eval('#chars', (el) => el.textContent), /Test Pal/, 'the home page lists it');
  assert.ok(await again.page.$('#chars img[src="/packs/test-pal/sheets/front.png"]'), 'with its front sheet as its picture');
  const scores = await open(browser, `${base}/lab/score.html?part=test-pal`, () => /^(DONE|ERROR)/.test(document.title));
  assert.match(await scores.page.title(), /^DONE/);
  assert.deepEqual([...again.errors, ...scores.errors], []);
});

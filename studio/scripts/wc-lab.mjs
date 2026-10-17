// Character Lab from the command line: drives the studio/ pages in headless Chrome (real GPU, same renderer
// and scorer as the studio) through the lab's own server (server.mjs, on a free port): the same packs
// (lab.config.json, LAB_PACKS) and mounts as `npm start`.
// Run from the lab's folder (`npm run lab -- <args>` is the same as `node studio/scripts/wc-lab.mjs <args>`):
//   npm run lab -- score                       every variant
//   npm run lab -- score --v=front --regions   one variant, plus every named part of the whole front
//   npm run lab -- score --part=character      one part's variants
//     --save=out/base.json      keep the results as a baseline
//     --compare=out/base.json   show the change against a saved baseline (parts too)
//     --json                    print the raw JSON
//   npm run lab -- shot --url="inspect.html?region=footL" --out=out/foot.png
//     screenshot of a studio/ page (--url is relative to studio/) once its title reads READY or DONE
// Improving the drawing with subagents (a pack's agents/README.md; its agents/packages.json, or --packages=<file>):
//   npm run lab -- board [--compare=out/base.json]     every variant by family (out/board.md + out/board.json)
//   npm run lab -- check --baseline=out/base.json --package=face   exit 1 if anything outside the package's scope
//     dropped by more than --tol (0.3) or lost its renderer; --scope='eyes,mouth,expr-*' instead of --package
//   npm run lab -- sheet --v=eye-open [--out=out/sheets/eye-open.png] [--h=360]   painting | ours | difference
//   npm run lab -- packages [--from=out/board.json]     each work package: variants, gaps, mean, worst five
// Animation (js/wc-anim.js, the clips in js/anim/):
//   npm run lab -- film --clip=nod [--frames=8] [--h=260] [--zoom=face|head|eyes|mouth|x,y,w,h] [--v=front] [--rig=1]
//     out/film/<clip>.png: the clip's frames side by side (--group=eyes: every clip of a group, one row each; --clip=a,b)
//     --fps=24 --cols=12 --labels=0 --idle=1: every frame at that rate, in a clean grid (to cut into a video)
// File paths (--out, --save, --compare) are relative to the lab's folder; its out/ is git-ignored.
import puppeteer from 'puppeteer-core';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createLabServer } from '../../server.mjs';
import { findPacks, readConfig } from '../../lab-config.mjs';
import { boardLines, compare, families, packageStatus } from './lab-board.mjs';

const LAB = resolve(dirname(fileURLToPath(import.meta.url)), '../..');   // the lab's folder
const LAB_PATH = '/studio/';
const MAC = process.platform === 'darwin';
// macOS: Chrome + Metal. Linux (the box): /usr/bin/google-chrome + SwiftShader software GL. CHROME= overrides the path.
const CHROME = MAC ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/google-chrome';
const GL_ARGS = MAC ? ['--use-angle=metal', '--enable-gpu'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'];
const labFile = (p) => resolve(LAB, p);

// --- pure helpers (tested) ---
export function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  return { cmd, ...Object.fromEntries(rest.map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : true]; })) };
}
export function scoreQuery(o) {
  const q = new URLSearchParams();
  if (o.v) q.set('v', o.v); else if (o.part) q.set('part', o.part);
  if (o.regions) q.set('regions', '1');
  if (o.display) q.set('display', o.display);
  q.set('h', '60');
  return q.toString();
}
const fmt = (d) => (d == null ? '' : d > 0 ? `+${d.toFixed(1)}` : d < 0 ? d.toFixed(1) : '0');
// Rows: [{ id, fidelity, parts? }]; base: the same shape (or null). Returns printable lines.
export function report(rows, base) {
  const prev = new Map((base || []).map((r) => [r.id, r]));
  const lines = [];
  for (const r of rows) {
    const p = prev.get(r.id), d = p && r.fidelity != null && p.fidelity != null ? r.fidelity - p.fidelity : null;
    lines.push(`${r.id.padEnd(22)} ${r.fidelity == null ? 'no renderer' : String(r.fidelity).padStart(5)}  ${fmt(d)}`);
    if (r.misses && r.misses.length) {
      const pm = new Map(((p && p.misses) || []).map((m) => [m.name, m]));
      lines.push('  landmarks that miss: ' + r.misses.map((m) => `${m.name} ${m.ours}|${m.ref} (${m.score.toFixed(2)}${pm.has(m.name) ? '' : ' new'})`).join(', '));
    }
    if (r.parts) {
      const pp = new Map(((p && p.parts) || []).map((x) => [x.name, x]));
      lines.push('  part           score    Δ    ΔE   SSIM  contr  edges   L50 ours|painting  chroma ours|painting');
      for (const x of r.parts) {
        const q = pp.get(x.name);
        lines.push(`  ${x.name.padEnd(13)} ${String(x.score).padStart(5)} ${fmt(q ? x.score - q.score : null).padStart(5)} ${String(x.dE).padStart(5)} ${x.ssim.toFixed(3)} ${x.contrast.toFixed(2).padStart(5)} ${x.edges.toFixed(2).padStart(6)}   ${String(x.L.ours[1]).padStart(5)}|${String(x.L.ref[1]).padEnd(5)}        ${x.chroma.ours}|${x.chroma.ref}`);
      }
    }
  }
  const scored = rows.filter((r) => r.fidelity != null);
  const mean = scored.reduce((s, r) => s + r.fidelity, 0) / Math.max(scored.length, 1);
  const changed = base ? rows.filter((r) => prev.has(r.id) && prev.get(r.id).fidelity !== r.fidelity).length : 0;
  lines.push(`${rows.length} variants, mean ${mean.toFixed(1)}${base ? `, ${changed} changed` : ''}`);
  return lines;
}

// --- browser ---
async function withLab(fn) {
  const server = createLabServer({ config: readConfig() });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || CHROME, headless: true,
    args: ['--ignore-gpu-blocklist', '--enable-webgl', ...GL_ARGS, '--disable-renderer-backgrounding', '--disable-background-timer-throttling'] });
  try {
    return await fn(browser, `http://127.0.0.1:${server.address().port}${LAB_PATH}`);
  } finally {
    await browser.close(); server.close();
  }
}
async function openUntil(browser, url, done, width = 1400) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('[page error]', e.message));
  await page.setViewport({ width, height: 1000, deviceScaleFactor: 1 });
  const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 0 });   // anim.html draws synchronously before load
  if (!res || !res.ok()) throw new Error(`${url}: HTTP ${res ? res.status() : 'no response'}`);
  await page.waitForFunction(done, { timeout: 600000 });
  const title = await page.title();
  if (title.startsWith('ERROR')) throw new Error(title);
  return page;
}

const readJSON = async (p) => JSON.parse(await readFile(labFile(p), 'utf8'));
async function writeOut(p, text) { const f = labFile(p); await mkdir(dirname(f), { recursive: true }); await writeFile(f, text); return f; }
const scoreRows = (o) => withLab(async (browser, base) => {
  const page = await openUntil(browser, `${base}score.html?${scoreQuery(o)}`, () => /^(DONE|ERROR)/.test(document.title));
  return page.evaluate(() => JSON.parse(document.getElementById('out').textContent));
});
async function score(o) {
  const rows = await scoreRows(o);
  const prev = o.compare ? await readJSON(o.compare) : null;
  if (o.save) await writeOut(o.save, JSON.stringify(rows, null, 1));
  console.log(o.json ? JSON.stringify(rows, null, 1) : report(rows, prev).join('\n'));
}
async function board(o) {
  const rows = await scoreRows(o), prev = o.compare ? await readJSON(o.compare) : null;
  const json = await writeOut(o.save || 'out/board.json', JSON.stringify(rows, null, 1));
  const md = await writeOut(o.md || 'out/board.md', ['# Character Lab board', '', ...boardLines(rows, prev)].join('\n') + '\n');
  for (const f of families(rows)) {
    const gaps = f.gaps.length ? `  ${f.gaps.length} without a renderer` : '';
    console.log(`${f.part.padEnd(12)} ${String(f.scored).padStart(3)}/${String(f.total).padEnd(3)} mean ${f.mean == null ? '  —  ' : f.mean.toFixed(1).padStart(5)}  worst ${f.worst ? `${f.worst.id} ${f.worst.fidelity}` : '—'}${gaps}`);
  }
  for (const r of rows.filter((x) => x.error)) console.log(`ERROR ${r.id}: ${r.error}`);
  console.log(boardLines(rows).at(-1));
  console.log(`${md}\n${json}`);
}
// The work packages: --packages=<file>, else the first pack (in load order) that has agents/packages.json.
async function packagesFile(o = {}) {
  if (o.packages) return readJSON(o.packages);
  for (const p of (await findPacks(await readConfig())).packs) {
    try { return JSON.parse(await readFile(resolve(p.dir, 'agents/packages.json'), 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  throw new Error('no work packages: no pack has agents/packages.json (or pass --packages=<file>)');
}
async function check(o) {
  if (!o.baseline) throw new Error('check needs --baseline=<file saved by score/board>');
  // --package judges its scope and the variants its files also affect; --scope judges everything (the orchestrator).
  const pkg = o.package ? (await packagesFile(o)).packages.find((p) => p.id === o.package) : null;
  if (o.package && !pkg) throw new Error(`no package "${o.package}" in the work packages`);
  const scope = pkg ? pkg.scope : String(o.scope || '').split(',').filter(Boolean), watch = pkg ? pkg.affects || [] : null;
  const rows = await scoreRows(o), c = compare(rows, await readJSON(o.baseline), { tol: +(o.tol ?? 0.3), scope, watch });
  if (o.json) console.log(JSON.stringify(c, null, 1));
  else {
    const line = (x) => `  ${x.id.padEnd(20)} ${String(x.before).padStart(5)} → ${String(x.after).padEnd(5)} ${x.delta > 0 ? '+' : ''}${x.delta.toFixed(1)}${x.inScope ? '' : '  (outside the scope)'}`;
    console.log(`scope: ${scope.join(', ') || '(none)'}${watch ? ` · also judged: ${watch.join(', ') || '(nothing else)'}` : ' · every other variant judged'} · tolerance ${o.tol ?? 0.3}`);
    console.log(`improved ${c.improved.length}:`); c.improved.forEach((x) => console.log(line(x)));
    console.log(`dropped ${c.regressions.length}:`); c.regressions.forEach((x) => console.log(line(x)));
    if (c.newRenderer.length) console.log(`new renderers: ${c.newRenderer.join(', ')}`);
    if (c.lostRenderer.length) console.log(`LOST renderers: ${c.lostRenderer.join(', ')}`);
    for (const r of rows.filter((x) => x.error)) console.log(`ERROR ${r.id}: ${r.error}`);
    console.log(`mean over variants scored both times ${c.meanCommon.before} → ${c.meanCommon.after}; scored ${c.coverage.before} → ${c.coverage.after} of ${c.coverage.total}`);
    console.log(c.ok ? 'CHECK OK' : 'CHECK FAILED: drops outside the scope or lost renderers');
  }
  if (!c.ok) process.exitCode = 1;
}
async function sheet(o) {
  if (!o.v) throw new Error('sheet needs --v=<variant id>');
  return shot({ url: `score.html?v=${encodeURIComponent(o.v)}&h=${o.h || 360}`, out: o.out || `out/sheets/${o.v}.png`, selector: '#row', width: 4000, tight: true });
}
async function film(o) {
  if (!o.clip && !o.group) throw new Error('film needs --clip=<id>[,<id>…] or --group=<group>');
  const q = new URLSearchParams();
  for (const k of ['clip', 'group', 'frames', 'h', 'zoom', 'v', 'p', 'rig', 'fps', 'cols', 'labels', 'idle']) if (o[k] != null && o[k] !== true) q.set(k, o[k]);
  const name = String(o.clip || 'group-' + o.group).replace(/[^\w.-]+/g, '_');
  return shot({ url: `anim.html?${q}`, out: o.out || `out/film/${name}.png`, width: o.width || 2400 });
}
async function packages(o) {
  const rows = o.from ? await readJSON(o.from) : await scoreRows(o), { packages: list } = await packagesFile(o);
  const status = list.map((p) => ({ ...packageStatus(p, rows), title: p.title, files: p.files }));
  if (o.json) { console.log(JSON.stringify(status, null, 1)); return; }
  for (const s of status) {
    console.log(`${s.id.padEnd(12)} ${s.title}\n  ${s.scored}/${s.total} scored · mean ${s.mean ?? '—'}${s.gaps.length ? ` · no renderer: ${s.gaps.join(' ')}` : ''}`);
    console.log(`  worst: ${s.worst.map((r) => `${r.id} ${r.fidelity}`).join(' · ')}\n  files: ${s.files.join(' ')}`);
  }
}
async function shot(o) {
  if (!o.url || !o.out) throw new Error('shot needs --url and --out');
  const out = labFile(o.out);
  await withLab(async (browser, base) => {
    // the studio (index.html) is ready once its score is shown (window.__wcScore); bake.html titles itself "score {…}"
    // once drawn; the other pages set READY or DONE
    const page = await openUntil(browser, base + o.url, () => /^(READY|DONE|ERROR|score )/.test(document.title) || !!window.__wcScore, +(o.width || 1400));
    const el = await page.$(o.selector || '#shot');
    await mkdir(dirname(out), { recursive: true });
    // --tight: only the element's children (a flex row is as wide as the page)
    const clip = o.tight && el ? await el.evaluate((e) => {
      const rs = [...e.children].map((c) => c.getBoundingClientRect());
      const x = Math.min(...rs.map((r) => r.left)), y = Math.min(...rs.map((r) => r.top));
      return { x, y, width: Math.max(...rs.map((r) => r.right)) - x, height: Math.max(...rs.map((r) => r.bottom)) - y };
    }) : null;
    await (clip ? page.screenshot({ path: out, clip }) : (el || page).screenshot({ path: out }));
  });
  console.log(out);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const o = parseArgs(process.argv.slice(2));
  const run = { score, shot, board, check, sheet, packages, film }[o.cmd];
  if (!run) { console.error('usage: wc-lab.mjs score|board|check|sheet|packages|shot|film [options]  (see the header of studio/scripts/wc-lab.mjs)'); process.exit(2); }
  run(o).catch((e) => { console.error(e.message); process.exit(1); });
}

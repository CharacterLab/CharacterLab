import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// A browser script that also fills module.exports; the lab's package.json makes .js files ES modules, so run it as a script.
const file = fileURLToPath(new URL('../js/wc-region-math.js', import.meta.url));
const mod = { exports: {} };
vm.runInThisContext(`(function (module) {${readFileSync(file, 'utf8')}\n})`, { filename: file })(mod);
const M = mod.exports;

// A w x h RGBA image filled by fn(x, y) -> [r, g, b].
function image(w, h, fn) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b] = fn(x, y), o = (y * w + x) * 4;
    d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
  }
  return d;
}
const W = 48, H = 48, BOX = [0, 0, W, H];
const stripes = (x) => (Math.floor(x / 4) % 2 ? [150, 100, 60] : [200, 150, 110]);

test('identical images: no colour difference, full structure, texture ratio 1', () => {
  const a = image(W, H, stripes), r = M.measure(a, a, W, H, BOX);
  assert.equal(r.dE, 0);
  assert.equal(r.ssim, 1);
  assert.equal(r.contrast, 1);
  assert.equal(r.edges, 1);
  assert.equal(r.score, 100);
});

test('a colour shift shows up as dE and in the Lab means, not in structure', () => {
  const a = image(W, H, stripes), b = image(W, H, (x) => stripes(x).map((v) => v - 30));
  const r = M.measure(a, b, W, H, BOX);
  assert.ok(r.dE > 5, `dE ${r.dE}`);
  assert.ok(r.lab.ours[0] > r.lab.ref[0], 'ours is lighter');
  assert.ok(r.L.ours[1] > r.L.ref[1], 'median L is higher');
  assert.ok(r.score < 100);
});

test('a flat render of a striped painting loses contrast, edges and structure', () => {
  const ref = image(W, H, stripes), flat = image(W, H, () => [175, 125, 85]);
  const r = M.measure(flat, ref, W, H, BOX);
  assert.ok(r.contrast < 0.1, `contrast ${r.contrast}`);
  assert.ok(r.edges < 0.1, `edges ${r.edges}`);
  assert.ok(r.ssim < 0.5, `ssim ${r.ssim}`);
  assert.ok(r.texture < 0.05);
});

test('paper-white pixels in both images are left out', () => {
  const white = image(W, H, () => [255, 255, 255]);
  const r = M.measure(white, white, W, H, BOX);
  assert.equal(r.pixels, 0);
  assert.equal(r.dE, 0);
});

test('the box is clamped to the image and only its pixels count', () => {
  const a = image(W, H, (x) => (x < 24 ? [120, 80, 50] : [255, 255, 255]));
  const b = image(W, H, (x) => (x < 24 ? [120, 80, 50] : [90, 60, 40]));
  const left = M.measure(a, b, W, H, [-10, -10, 24, 60]);
  assert.equal(left.dE, 0);
  assert.equal(left.pixels, 24 * H);
  const right = M.measure(a, b, W, H, [24, 0, 100, H]);
  assert.ok(right.dE > 20);
});

// Same conversion as the lab scorer (wc-compare.js), whose rounded matrix leaves white at b = -0.01.
test('srgbToLab: white is L 100, black L 0, neutral greys have (almost) no colour', () => {
  const [Lw, aw, bw] = M.srgbToLab(255, 255, 255), [Lk] = M.srgbToLab(0, 0, 0), [, ag, bg] = M.srgbToLab(128, 128, 128);
  assert.ok(Math.abs(Lw - 100) < 0.01 && Math.abs(aw) < 0.02 && Math.abs(bw) < 0.02);
  assert.ok(Math.abs(Lk) < 0.01);
  assert.ok(Math.abs(ag) < 0.02 && Math.abs(bg) < 0.02);
});

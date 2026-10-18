import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadLab } from '../lab/scripts/lab-vm.mjs';

const plain = (x) => JSON.parse(JSON.stringify(x));   // values made in the vm, compared here
const round = (xs) => plain(xs).map((v) => Math.round(v * 1e6) / 1e6);

// The scenario registry (lab/js/lab-scenarios.js): what register accepts and refuses, the params and the sweep, and a
// frame composed on a throwaway pack (a square figure on its own backdrop, standing in a slot), with no GPU.
const ok = (extra = {}) => Object.assign({ id: 'dot-yard', label: 'Yard', pack: 'dot', world: [400, 300],
  params: { wind: { min: 0, max: 1, step: 0.1, value: 0.5 } }, build: () => ({ ops: [] }) }, extra);

const DOT = `(function () {
  const CL = window.CharacterLab;
  const sq = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const build = (p = {}) => ({ world: [100, 100], ops: [
    { kind: "fill", pts: sq(-10, -10, 110, 110), mat: { type: 8, ramp: ["#fff", "#fff", "#fff", "#fff"] }, seed: 1 },
    { kind: "fill", pts: sq(40, 20, 60, 90), mat: { type: 8, ramp: ["#000", "#000", "#f80", "#f80"] }, seed: 2, part: "body" },
  ], rig: { def: { body: { pivot: [50, 90] } }, pose: p.pose || {} } });
  CL.lab.registerCharacter({ id: "dot", label: "Dot", parts: [{ id: "dot", label: "Whole", whole: true,
    variants: [{ id: "dot-front", label: "Front", kind: "mapped", frame: [0, 0, 100, 100], scale: 1, fit: { s: 1, tx: 0, ty: 0 }, build }] }],
    rig: { parts: ["body"] }, clips: [{ id: "dot-hop", dur: 1, pose: { body: { dy: [[0, 0], [0.5, -10], [1, 0]] } } }] });
  CL.scenarios.register({ id: "dot-yard", label: "Yard", pack: "dot", world: [400, 300],
    params: { lift: { min: 0, max: 50, value: 0 } }, slots: [{ id: "grass", x: 200, y: 250, w: 100 }],
    build: (p) => ({ ops: [{ kind: "fill", pts: sq(0, 250, 400, 300), mat: { type: 8, ramp: ["#4a4", "#4a4", "#6c6", "#6c6"] }, seed: 9 }] }),
    cast: (p) => [{ variant: "dot-front", slot: "grass", dy: -p.lift, h: 140, clip: "dot-hop" }] });
})();`;
async function dotPack() {
  const dir = await mkdtemp(join(tmpdir(), 'lab-scenarios-'));
  await mkdir(join(dir, 'dot'));
  await writeFile(join(dir, 'dot', 'pack.json'), JSON.stringify({ id: 'dot', label: 'Dot', scripts: ['dot.js'] }));
  await writeFile(join(dir, 'dot', 'dot.js'), DOT);
  return pathToFileURL(join(dir, 'dot') + '/');
}

test('register checks the whole definition before adding it', async () => {
  const L = await loadLab(), S = L.scenarios;
  const bad = [
    [{ id: 'Bad id' }, /bad id/], [{ label: '' }, /needs a label/], [{ pack: undefined }, /pack it belongs to/],
    [{ world: [0, 10] }, /world/], [{ build: undefined }, /needs build/], [{ draw: 3 }, /draw must be a function/],
    [{ params: { wind: { min: 1, max: 0, value: 0 } } }, /max must be above min/],
    [{ params: { wind: { min: 0, max: 1, value: 2 } } }, /outside/], [{ params: { wind: { min: 0, max: 1, value: 0, step: 0 } } }, /step/],
    [{ slots: [{ id: 'a', x: 0, y: 0 }, { id: 'a', x: 1, y: 1 }] }, /named twice/],
    [{ cast: [{ variant: 'x', h: 10, slot: 'nowhere' }] }, /does not have/], [{ cast: [{ variant: 'x', x: 1, y: 1 }] }, /height h/],
    [{ cast: [{ variant: 'x', h: 10 }] }, /needs x and y, or a slot/], [{ notes: 5 }, /notes/],
  ];
  for (const [extra, msg] of bad) assert.throws(() => S.register(ok(extra)), msg, JSON.stringify(extra));
  assert.deepEqual(plain(S.list().map((s) => s.id)), [], 'nothing half-registered');
  const sc = S.register(ok());
  assert.equal(sc.params.wind.label, 'wind', 'a param without a label is named by its key');
  assert.throws(() => S.register(ok()), /registered twice/);
  assert.equal(S.get('dot-yard'), sc);
  assert.deepEqual(plain(S.list('dot').map((s) => s.id)), ['dot-yard']);
  assert.deepEqual(plain(S.list('other')), []);
});

test('params clamp to their range and the sweep goes min > max > min with a sine ease', async () => {
  const S = (await loadLab()).scenarios, sc = S.register(ok({ params: { a: { min: -2, max: 2, value: 1 }, b: { min: 0, max: 10, value: 3 } } }));
  assert.deepEqual(plain(S.params(sc, {})), { a: 1, b: 3 });
  assert.deepEqual(plain(S.params(sc, { a: '9', b: 'x' })), { a: 2, b: 3 });
  assert.deepEqual(plain(S.params('dot-yard', { a: -5, b: 4 })), { a: -2, b: 4 });
  const spec = sc.params.b;
  assert.equal(S.sweep(spec, 0), 0);
  assert.equal(S.sweep(spec, 0.5), 10);
  assert.ok(Math.abs(S.sweep(spec, 1)) < 1e-9);
  assert.ok(Math.abs(S.sweep(spec, 0.25) - 5) < 1e-9 && S.sweep(spec, 0.1) < 1, 'eased: slow at the ends');
  assert.throws(() => S.params('nope', {}), /no such scenario/);
});

test('a frame stands the figure on its soles in its slot, without its backdrop, and reports the gap', async () => {
  const L = await loadLab({ packs: [await dotPack()] }), S = L.scenarios, sc = S.get('dot-yard');
  const f = S.frame(sc, S.params(sc, {}), 0);
  assert.equal(f.ops.length, 1);
  const [c] = f.cast;
  assert.equal(c.scene.ops.length, 1, 'the figure\'s own backdrop is left out');
  assert.deepEqual(plain(c.place.foot), [50, 90], 'feet at its soles, under the middle of its box');
  assert.equal(c.place.k, 1.4);
  assert.deepEqual(round(c.place.rect), [130, 124, 140, 140]);
  assert.equal(c.soles, 250);
  assert.equal(c.gap, 0);
  const up = S.frame(sc, S.params(sc, { lift: 30 }), 0).cast[0];
  assert.ok(Math.abs(up.gap - 30) < 1e-9, 'lifted by 30');
  const hop = S.frame(sc, S.params(sc, {}), 0.5).cast[0];
  assert.ok(Math.abs(hop.gap - 14) < 1e-9, 'its clip lifts it 10 model units: 14 scene units');
  const held = S.frame(Object.assign({}, sc, { cast: [{ variant: 'dot-front', slot: 'grass', h: 140, clip: 'dot-hop', clipAt: 0 }] }), {}, 0.5).cast[0];
  assert.equal(held.gap, 0, 'clipAt holds a frame of the clip');
  assert.equal(S.clipLength(sc, S.params(sc, {})), 1);
  const kept = S.pose(c.variant, { keepBackdrop: true, h: 1, x: 0, y: 0 }, 0);
  assert.equal(kept.ops.length, 2);
  const flip = S.place(c.variant, { h: 140, x: 200, y: 250, flip: true });
  assert.deepEqual(round(flip.rect), [130, 124, 140, 140], 'a mirrored figure keeps its box');
  assert.throws(() => S.frame(Object.assign({}, sc, { cast: [{ variant: 'nobody', x: 1, y: 1, h: 10 }] }), {}, 0), /no such variant: nobody/);
  assert.throws(() => S.frame(Object.assign({}, sc, { cast: [{ variant: 'dot-front', x: 1, y: 1, h: 10, clip: 'nope' }] }), {}, 0), /no such clip: nope/);
});

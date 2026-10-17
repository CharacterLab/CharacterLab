import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// The renderer's extension API (studio/js/wc-gl.js: registerMaterial, registerMode) and the shader it composes.
// No GPU here: the composed GLSL is checked as text; npm run lab -- score / shot run it for real. How the private
// packs' materials splice in is tested in those packs.
const LAB = new URL('../', import.meta.url);
const ENGINE = new URL('studio/js/wc-gl.js', LAB);

async function engine(extra = []) {
  const ctx = vm.createContext({});
  ctx.window = ctx;
  for (const u of [ENGINE, ...extra.map((p) => new URL(p, LAB))]) vm.runInContext(await readFile(u, 'utf8'), ctx, { filename: u.pathname });
  return ctx.CharacterLab.wcGL;
}
const mat = (id, o = {}) => ({ id, glsl: {}, ...o });

test('the engine carries only its generic materials (packs bring the rest)', async () => {
  const fs = (await engine()).fragmentSource();
  for (const name of ['sdAlmond', 'leafField', 'barbShade', 'uGroove', 'uBark', 'uCell', 'uDome']) assert.ok(!fs.includes(name), name);
  for (const name of ['wash(', 'softEdge(', 'pencil(', 'celFill(', 'uMode == 6', 'uMode == 7', 'uMode == 11']) assert.ok(fs.includes(name), name);
});

test('a registered material and mode land in the shader with their uniforms', async () => {
  const GL = await engine();
  GL.registerMode({ id: 'ring', kind: 'ring', blend: 'multiply', requires: ['stone'], glsl: { fn: '\n    o = vec4(1.0); return;' }, box: () => [0, 0, 1, 1] });
  GL.registerMaterial(mat('stone', { type: 12, uniforms: { uGrain: 'float' }, glsl: { decl: 'float grain(vec2 p) { return vnoise(p); }', fn: '\n  col *= grain(pm);', wash: '\n  col *= 1.0;' } }));
  GL.registerMaterial(mat('glow', { type: 13, base: 'none', glsl: { fn: '\n  col = uC3;' } }));
  const fs = GL.fragmentSource();
  assert.ok(fs.indexOf('uniform float uGrain;') < fs.indexOf('float grain(vec2 p)'));
  assert.match(fs, /vec3 ext_stone\(vec3 col, vec2 p, float d, vec2 grad, vec2 pm\) \{\n  col \*= grain\(pm\);\n  return col;\n\}/);
  assert.match(fs, /if \(uMat == 13\) col = ext_glow\(uC2, p, d, grad, p\);\n    else /, 'base "none": instead of the wash');
  assert.match(fs, /if \(uMat == 12\) col = ext_stone\(col, p, d, grad, pm\);/, 'base "wash": over the wash');
  assert.match(fs, /\/\/ wash: stone/);
  assert.match(fs, /if \(uMode == 32\) \{ \/\/ ring \(ring\)/);
  assert.deepEqual([...GL.extensions().map((e) => e.id)], ['glow', 'stone', 'ring']);
});

test('registrations are checked', async () => {
  const GL = await engine();
  const m = (d) => () => GL.registerMaterial(d), md = (d) => () => GL.registerMode(d);
  assert.throws(m(null), /needs a definition/);
  assert.throws(m(mat('Bad id')), /bad id/);
  assert.throws(m(mat('a', { type: 8, glsl: { fn: 'x' } })), /type 8 is the engine's/);
  assert.throws(m(mat('a', { type: 1.5, glsl: { fn: 'x' } })), /positive integer/);
  assert.throws(m(mat('a', { type: 12 })), /needs glsl.fn/);
  assert.throws(m(mat('a', { glsl: { fn: 'x' } })), /glsl.fn needs a type/);
  assert.throws(m(mat('a', { uniforms: { grain: 'float' } })), /bad uniform/);
  assert.throws(m(mat('a', { uniforms: { uGrain: 'double' } })), /bad uniform/);
  assert.throws(m(mat('a', { base: 'paper' })), /base must be/);
  assert.throws(md({ id: 'f', kind: 'fill', glsl: { fn: 'x' }, box: () => [] }), /kind "fill" is the engine's/);
  assert.throws(md({ id: 'r', kind: 'ring', glsl: {}, box: () => [] }), /needs glsl.fn/);
  assert.throws(md({ id: 'r', kind: 'ring', glsl: { fn: 'x' } }), /needs box/);
  assert.throws(md({ id: 'r', kind: 'ring', blend: 'screen', glsl: { fn: 'x' }, box: () => [] }), /blend must be/);
  GL.registerMaterial(mat('a', { type: 12, glsl: { fn: 'x' } }));
  assert.throws(m(mat('a')), /registered twice/);
  assert.throws(m(mat('b', { type: 12, glsl: { fn: 'x' } })), /type 12 is taken by "a"/);
  GL.registerMode({ id: 'r', kind: 'ring', glsl: { fn: 'x' }, box: () => [] });
  assert.throws(md({ id: 's', kind: 'ring', glsl: { fn: 'x' }, box: () => [] }), /kind "ring" is taken by "r"/);
});

test('a missing or circular requirement is reported when the shader is composed', async () => {
  const GL = await engine();
  GL.registerMaterial(mat('a', { requires: ['nowhere'] }));
  assert.throws(() => GL.fragmentSource(), /"a" requires "nowhere", which is not registered/);
  const G2 = await engine();
  G2.registerMaterial(mat('a', { requires: ['b'] }));
  G2.registerMaterial(mat('b', { requires: ['a'] }));
  assert.throws(() => G2.fragmentSource(), /in a circle: a, b/);
});

test('the cel demo page draws engine-only cel fills', async () => {
  const html = await readFile(new URL('studio/cel.html', LAB), 'utf8');
  const srcs = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(srcs, ['js/wc-gl.js'], 'no pack: the engine alone');
  assert.match(html, /type: 8/);
  const fs = (await engine()).fragmentSource();
  assert.match(fs, /if \(uMode == 7\) \{ \/\/ a cel fill/);
  assert.equal((await engine()).CEL, 8);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { inScope, families, compare, boardLines, packageStatus } from '../scripts/lab-board.mjs';

const row = (id, part, fidelity) => ({ id, part, fidelity, renderer: fidelity != null });
const ROWS = [row('front', 'character', 79.5), row('side', 'character', 68.5), row('eye-open', 'eyes', 59.6),
  row('eye-l', 'eyes', 49.9), row('shell-front', 'shell', undefined), row('expr-happy', 'expressions', 60)];

test('inScope matches a part, a variant or a prefix ending in *', () => {
  assert.ok(inScope(ROWS[2], ['eyes']));
  assert.ok(inScope(ROWS[0], ['front']));
  assert.ok(inScope(ROWS[5], ['expr-*']));
  assert.ok(!inScope(ROWS[1], ['front', 'eyes', 'expr-*']));
  assert.ok(!inScope(ROWS[0], []));
});

test('families groups variants by part with gaps, mean and the worst variant', () => {
  const f = families(ROWS);
  assert.deepEqual(f.map((x) => x.part), ['character', 'eyes', 'shell', 'expressions']);
  const eyes = f.find((x) => x.part === 'eyes');
  assert.equal(eyes.total, 2); assert.equal(eyes.scored, 2); assert.equal(eyes.mean, 54.75);
  assert.equal(eyes.worst.id, 'eye-l');
  const shell = f.find((x) => x.part === 'shell');
  assert.deepEqual(shell.gaps, ['shell-front']); assert.equal(shell.mean, null);
});

test('compare flags drops beyond the tolerance and separates the ones outside the scope', () => {
  const now = [row('front', 'character', 79.0), row('side', 'character', 68.6), row('eye-open', 'eyes', 57.0),
    row('eye-l', 'eyes', 49.8), row('shell-front', 'shell', 55), row('expr-happy', 'expressions', undefined)];
  const c = compare(now, ROWS, { tol: 0.3, scope: ['eyes'] });
  assert.deepEqual(c.regressions.map((x) => x.id), ['eye-open', 'front']);
  assert.deepEqual(c.outOfScope.map((x) => x.id), ['front']);
  assert.deepEqual(c.newRenderer, ['shell-front']);
  assert.deepEqual(c.lostRenderer, ['expr-happy']);
  assert.equal(c.coverage.before, 5); assert.equal(c.coverage.after, 5); assert.equal(c.coverage.total, 6);
  // the mean over variants scored both times: front, side, eye-open, eye-l
  assert.equal(c.meanCommon.before, 64.375); assert.equal(c.meanCommon.after, 63.6);
  assert.ok(!c.ok, 'out-of-scope regressions and lost renderers fail the check');
  assert.ok(compare(ROWS, ROWS).ok);
});

test('compare with a watch list judges only the variants a package can affect (agents sharing one checkout)', () => {
  const now = [row('front', 'character', 79.0), row('side', 'character', 60), row('eye-open', 'eyes', 57.0),
    row('eye-l', 'eyes', 49.9), row('shell-front', 'shell', undefined), row('expr-happy', 'expressions', 60)];
  const c = compare(now, ROWS, { scope: ['expressions'], watch: ['front'] });
  assert.deepEqual(c.outOfScope.map((x) => x.id), ['front'], 'side and eye-open dropped too, but this package cannot touch them');
  assert.ok(!c.ok);
  assert.ok(compare(now, ROWS, { scope: ['expressions'], watch: [] }).ok);
});

test('compare reports a variant that disappeared as a lost renderer, and refuses a tolerance that is not a number', () => {
  const c = compare(ROWS.filter((r) => r.id !== 'eye-l'), ROWS, { scope: ['eyes'] });
  assert.deepEqual(c.lostRenderer, ['eye-l']);
  assert.ok(!c.ok);
  assert.throws(() => compare(ROWS, ROWS, { tol: NaN }), /tolerance/);
});

test('boardLines copes with rows of which none is scored', () => {
  assert.match(boardLines([row('shell-front', 'shell', undefined)]).at(-1), /^1 variants, 0 scored, mean —/);
});

test('boardLines prints a table per family, marks gaps and shows the change', () => {
  const lines = boardLines(ROWS, ROWS.map((r) => (r.id === 'front' ? { ...r, fidelity: 79 } : r)));
  const text = lines.join('\n');
  assert.match(text, /^## character · 2 variants · mean 74\.0$/m);
  assert.match(text, /\| front \| 79\.5 \| \+0\.5 \|/);
  assert.match(text, /\| shell-front \| — \| no renderer \|/);
  assert.match(lines.at(-1), /^6 variants, 5 scored, mean 63\.5/);
});

test('packageStatus summarises the variants a package owns, worst first', () => {
  const s = packageStatus({ id: 'face', scope: ['eyes', 'shell'] }, ROWS);
  assert.equal(s.total, 3); assert.equal(s.scored, 2); assert.deepEqual(s.gaps, ['shell-front']);
  assert.deepEqual(s.worst.map((x) => x.id), ['eye-l', 'eye-open']);
  assert.equal(s.mean, 54.75);
});

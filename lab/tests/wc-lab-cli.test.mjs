import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, report, scoreQuery } from '../scripts/wc-lab.mjs';

test('parseArgs reads the command and --key=value flags', () => {
  assert.deepEqual(parseArgs(['score', '--v=front', '--regions', '--url=a.html?x=1&y=2']),
    { cmd: 'score', v: 'front', regions: true, url: 'a.html?x=1&y=2' });
});

test('scoreQuery prefers one variant over a part and passes regions', () => {
  assert.equal(scoreQuery({ v: 'front', part: 'eyes', regions: true }), 'v=front&regions=1&h=60');
  assert.equal(scoreQuery({ part: 'eyes' }), 'part=eyes&h=60');
  assert.equal(scoreQuery({}), 'h=60');
});

test('report shows each variant, its change against a baseline, and the mean', () => {
  const rows = [{ id: 'front', fidelity: 79.6 }, { id: 'side', fidelity: 68.5 }, { id: 'basket', fidelity: null }];
  const base = [{ id: 'front', fidelity: 79.3 }, { id: 'side', fidelity: 68.5 }];
  const lines = report(rows, base);
  assert.match(lines[0], /^front\s+79\.6\s+\+0\.3$/);
  assert.match(lines[1], /^side\s+68\.5\s+0$/);
  assert.match(lines[2], /no renderer/);
  assert.equal(lines.at(-1), '3 variants, mean 74.0, 1 changed');
});

test('report lists named parts worst first with their change', () => {
  const part = (name, score) => ({ name, score, dE: 5, ssim: 0.5, contrast: 1, edges: 1, L: { ours: [1, 50, 90], ref: [1, 52, 90] }, chroma: { ours: 20, ref: 21 } });
  const rows = [{ id: 'front', fidelity: 80, parts: [part('footL', 55), part('nose', 80)] }];
  const base = [{ id: 'front', fidelity: 79, parts: [part('footL', 60), part('nose', 80)] }];
  const lines = report(rows, base);
  assert.match(lines[2], /footL\s+55\s+-5\.0/);
  assert.match(lines[3], /nose\s+80\s+0/);
});

test('report names the landmarks that miss and marks the new ones', () => {
  const rows = [{ id: 'front', fidelity: 78, misses: [{ name: 'eyeL y', ours: 139, ref: 140.6, score: 0.7 }, { name: 'nut left', ours: 112, ref: 106, score: 0 }] }];
  const base = [{ id: 'front', fidelity: 79, misses: [{ name: 'nut left', ours: 112, ref: 106, score: 0 }] }];
  const line = report(rows, base)[1];
  assert.match(line, /eyeL y 139\|140\.6 \(0\.70 new\)/);
  assert.match(line, /nut left 112\|106 \(0\.00\)/);
});

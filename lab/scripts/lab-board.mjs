// The lab's scoreboard, regression check and work-package status: pure functions over the rows that
// score.html returns ([{ id, part, fidelity, renderer, ... }], fidelity undefined when a variant has no renderer).
// wc-lab.mjs prints them; the orchestrator and every subagent read the same numbers (a pack's agents/README.md).

export const isScored = (r) => r.fidelity != null;
const round = (x) => +x.toFixed(3);
const mean = (xs) => (xs.length ? round(xs.reduce((s, x) => s + x, 0) / xs.length) : null);
const fmt = (d) => (d == null ? '' : d > 0 ? `+${d.toFixed(1)}` : d < 0 ? d.toFixed(1) : '0');

// A scope is a list of part ids, variant ids, or prefixes ending in * ('expr-*').
export function inScope(row, scope = []) {
  return scope.some((t) => (t.endsWith('*') ? row.id.startsWith(t.slice(0, -1)) : t === row.id || t === row.part));
}

export function families(rows) {
  const by = new Map();
  for (const r of rows) { if (!by.has(r.part)) by.set(r.part, []); by.get(r.part).push(r); }
  return [...by].map(([part, rs]) => {
    const scored = rs.filter(isScored);
    const worst = scored.reduce((w, r) => (!w || r.fidelity < w.fidelity ? r : w), null);
    return { part, total: rs.length, scored: scored.length, gaps: rs.filter((r) => !isScored(r)).map((r) => r.id),
      mean: mean(scored.map((r) => r.fidelity)), worst, rows: rs };
  });
}

// What changed against a baseline. ok = nothing outside the scope dropped by more than tol and no renderer was lost.
// watch (optional): judge only the scope plus these variants, the ones a package's files can also change, so agents
// working at the same time in one checkout are not failed by each other's work.
export function compare(rows, base, { tol = 0.3, scope = [], watch = null } = {}) {
  if (!Number.isFinite(tol)) throw new Error(`the tolerance must be a number, not ${tol}`);
  const judged = (r) => watch == null || inScope(r, scope) || inScope(r, watch);
  const prev = new Map(base.map((r) => [r.id, r]));
  const changes = [], newRenderer = [], lostRenderer = [];
  for (const r of rows) {
    const p = prev.get(r.id);
    if (!p || !judged(r)) continue;
    if (isScored(r) && !isScored(p)) newRenderer.push(r.id);
    else if (!isScored(r) && isScored(p)) lostRenderer.push(r.id);
    else if (isScored(r)) changes.push({ id: r.id, part: r.part, before: p.fidelity, after: r.fidelity, delta: round(r.fidelity - p.fidelity), inScope: inScope(r, scope) });
  }
  const now = new Set(rows.map((r) => r.id));   // a variant that disappeared lost its renderer too
  for (const p of base) if (!now.has(p.id) && isScored(p) && judged(p)) lostRenderer.push(p.id);
  const regressions = changes.filter((c) => c.delta < -tol).sort((a, b) => a.delta - b.delta);
  const outOfScope = regressions.filter((c) => !c.inScope);
  return {
    changes, regressions, outOfScope, newRenderer, lostRenderer,
    improved: changes.filter((c) => c.delta > tol).sort((a, b) => b.delta - a.delta),
    meanCommon: { before: mean(changes.map((c) => c.before)), after: mean(changes.map((c) => c.after)) },
    coverage: { before: base.filter(isScored).length, after: rows.filter(isScored).length, total: rows.length },
    ok: outOfScope.length === 0 && lostRenderer.length === 0,
  };
}

// Markdown: one table per family (variant, score, change, the components that explain it), then the totals.
export function boardLines(rows, base = null) {
  const prev = new Map((base || []).map((r) => [r.id, r]));
  const lines = [];
  for (const f of families(rows)) {
    lines.push(`## ${f.part} · ${f.total} variants · mean ${f.mean == null ? '—' : f.mean.toFixed(1)}`, '',
      '| variant | score | Δ | silhouette | palette | SSIM | texture | landmarks |', '|---|---|---|---|---|---|---|---|');
    for (const r of f.rows) {
      if (!isScored(r)) { lines.push(`| ${r.id} | — | no renderer | | | | | |`); continue; }
      const p = prev.get(r.id), d = p && isScored(p) ? r.fidelity - p.fidelity : null;
      const n = (x, k = 2) => (x == null ? '' : (+x).toFixed(k));
      lines.push(`| ${r.id} | ${r.fidelity} | ${fmt(d)} | ${n(r.iou)} | ${n(r.palette)} | ${n(r.ssim, 3)} | ${n(r.texture)} | ${n(r.landmarks)} |`);
    }
    lines.push('');
  }
  const scored = rows.filter(isScored);
  const m = mean(scored.map((r) => r.fidelity));
  lines.push(`${rows.length} variants, ${scored.length} scored, mean ${m == null ? '—' : m.toFixed(1)}`);
  return lines;
}

// A work package (a pack's agents/packages.json) against the current rows.
export function packageStatus(pkg, rows) {
  const own = rows.filter((r) => inScope(r, pkg.scope));
  const scored = own.filter(isScored);
  return { id: pkg.id, total: own.length, scored: scored.length, gaps: own.filter((r) => !isScored(r)).map((r) => r.id),
    mean: mean(scored.map((r) => r.fidelity)), worst: [...scored].sort((a, b) => a.fidelity - b.fidelity).slice(0, 5) };
}

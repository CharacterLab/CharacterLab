// Drawing helpers every character pack shares (CharacterLab.lab.geom): outlines as point lists in model units, a seeded random
// generator and the default painted fill. A pack draws with these and CharacterLab.wcGL; it never borrows another pack's helpers.
//   ellipse(cx, cy, rx, ry, rot = 0, n = 48)   n points round an ellipse turned by rot (radians)
//   spline(ctrl, closed = true, per = 8)       a Catmull-Rom curve through the control points, `per` points a segment
//   rng(seed)                                  a deterministic random generator (mulberry32): () => [0, 1)
//   flat(ramp, extra)                          the painted fill material (wc-gl.js type 6) with a warm ink line, `extra` over it
(function () {
  const CharacterLab = (window.CharacterLab = window.CharacterLab || {});

  function ellipse(cx, cy, rx, ry, rot = 0, n = 48) {
    const c = Math.cos(rot), s = Math.sin(rot), out = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, x = Math.cos(a) * rx, y = Math.sin(a) * ry;
      out.push([cx + x * c - y * s, cy + x * s + y * c]);
    }
    return out;
  }
  function spline(ctrl, closed = true, per = 8) {
    const out = [], n = ctrl.length;
    const P = (i) => (closed ? ctrl[(i + n) % n] : ctrl[Math.max(0, Math.min(n - 1, i))]);
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
      for (let k = 0; k < per; k++) {
        const t = k / per, t2 = t * t, t3 = t2 * t;
        const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
      }
    }
    if (!closed) out.push(ctrl[n - 1]);
    return out;
  }
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const LINE = "#5a3a26";
  const flat = (ramp, extra) => Object.assign({ type: 6, ramp, radius: 30, light: 0.12, edge: 9, bottom: 0.5, fuzz: 0.7, fur: 0.75, strokes: 1.0, line: LINE }, extra || {});

  CharacterLab.lab = Object.assign({}, CharacterLab.lab, { geom: Object.freeze({ ellipse, spline, rng, flat, LINE }) });
})();

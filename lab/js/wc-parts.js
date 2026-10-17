// Shared drawing primitives for parts (the painted fill with a furry edge, ellipses, shapes), on top of CharacterLab.lab.geom
// (js/lab-geom.js). Pack families draw their parts with these.
(function () {
  const CharacterLab = window.CharacterLab;
  const { ellipse, flat: fur, LINE } = CharacterLab.lab.geom;
  function bounds(pts) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
  }
  const shade = (hex, k) => "#" + [1, 3, 5].map((i) => Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * k)).toString(16).padStart(2, "0")).join("");

  // A soft shape: a contact shadow, then a wash with a furry edge.
  function furShape(pts, ramp, o = {}) {
    const ops = [];
    if (o.shadow !== false) ops.push({ kind: "shadow", pts, off: o.shadowOff || [0.6, 2.4], amt: o.shadowAmt == null ? 0.16 : o.shadowAmt, tint: "#a07850", mat: { soft: 4 } });
    ops.push({ kind: "fill", pts, seed: o.seed || 21, mat: fur(ramp, Object.assign({
      radius: o.radius || 30, edge: o.edge || 10, bottom: o.bottom == null ? 0.6 : o.bottom, side: o.side == null ? 0.3 : o.side,
      lineAmt: o.lineAmt == null ? 0.08 : o.lineAmt, lineW: 0.5, fur: o.fur == null ? 1.0 : o.fur, fuzz: o.fuzz == null ? 0.9 : o.fuzz,
    }, o.mat || {})) });
    return ops;
  }
  // Inner ear: a soft pool of colour, darkest in its middle.
  const earInner = (pts, ramp, seed = 13) => [{ kind: "fill", pts, mat: { type: 1, ramp, radius: 8, soft: 4, alpha: 0.95 }, seed }];
  // A hole in a mask (the sheet shows paper where the eyes go).
  const paper = (pts) => ({ kind: "fill", pts, mat: { type: 6, ramp: ["#ffffff", "#ffffff", "#ffffff", "#ffffff"], light: 0, bottom: 0, fuzz: 0.2, fur: 0, strokes: 0 }, seed: 1 });

  // A soft white highlight (a blush would multiply, and white multiplies to nothing).
  const glow = (e, amt = 0.5, seed = 1) => ({ kind: "fill", pts: ellipse(e.c[0], e.c[1], e.r[0], e.r[1], e.rot || 0), seed,
    mat: { type: 1, ramp: ["#ffffff", "#ffffff", "#ffffff", "#ffffff"], radius: Math.max(e.r[0], e.r[1]), soft: Math.max(e.r[0], e.r[1]) * 0.9, alpha: amt } });

  CharacterLab.wcParts = { LINE, fur, ellipse, bounds, shade, furShape, earInner, paper, glow };
})();

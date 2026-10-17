// Captain Kite's face, drawn in code: the eyes, brows, nose, mouth, blush and Milo's glasses, flat cel shapes over the
// traced head (kite-shapes.js). Every feature sits where it was measured on that figure's sheet (its face record:
// eyes as openings and irises, brows as centre lines with a thickness, the nose's shadow, the mouth's corners), and the
// face params move it. CharacterLab.captainKite.face(F, p, C) -> { brows: [ops], face: [ops] }; the brows go under the mask.
//
// Face params (the lab's conventions; every one optional, an absent one draws the face as the sheet paints it):
//   eyes / eyeL / eyeR   'open' | 'wide' | 'half' | 'closed' = 'sleepy' (a ‿ line) | 'happy' (an arch ^) | 'wink'
//                        (L / R: the eye on the viewer's left / right)
//   lid / lidL / lidR    0..1, the upper lid comes down (a blink)
//   look, lookL, lookR, lookY   -1..1, the irises turn right (+) / left, down (+) / up
//   happy 0..1           0.5 and over: the eyes close into the happy arch
//   brows / browL / browR   'neutral' | 'raised' | 'high' | 'flat' | 'low' | 'sleepy' | 'angry' = 'determined' |
//                        'worried' | 'sad' | 'curious';  brow: a number, both brows up (+)
//   mouth                'painted' (as the sheet paints it) | smile | cat | smile2 | sleepy | frown | worried | grim |
//                        open | happy | excited | laugh | grin | tongue | o | surprised
//   smile -1..1.5        a closed mouth bends: up into a broader smile, down into a frown
//   mouthOpen 0..1       a closed mouth opens;  mouthRound 0..1  toward an O
//   blush 0..1 | 'soft' | 'bright';  glasses true | false (Milo's round glasses)
(function () {
  const CharacterLab = (window.CharacterLab = window.CharacterLab || {});
  const NS = (CharacterLab.captainKite = CharacterLab.captainKite || {});
  const num = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const own = (t, k) => (typeof k === "string" && Object.prototype.hasOwnProperty.call(t, k) ? t[k] : undefined);

  // ---------- geometry ----------
  function ellipse(cx, cy, rx, ry, n = 40) {
    return Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)]; });
  }
  // a Catmull-Rom curve through the points (open)
  function curve(ctrl, per = 8) {
    if (CharacterLab.lab && CharacterLab.lab.geom) return CharacterLab.lab.geom.spline(ctrl, false, per);
    return ctrl.slice();
  }
  // A thick line along a polyline as one closed outline: half-width w (a number, or one per point), the ends tapered.
  function band(pts, w, taper = 0.35) {
    const n = pts.length, L = [], R = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      let dx = b[0] - a[0], dy = b[1] - a[1];
      const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
      const s = i / Math.max(n - 1, 1), end = Math.min(s, 1 - s);
      const k = taper > 0 ? Math.min(1, 0.35 + end / taper) : 1;
      const hw = (Array.isArray(w) ? w[i] : w) * k;
      L.push([pts[i][0] - dy * hw, pts[i][1] + dx * hw]);
      R.push([pts[i][0] + dy * hw, pts[i][1] - dx * hw]);
    }
    return L.concat(R.reverse());
  }
  const signedArea = (P) => P.reduce((s, p, i) => { const q = P[(i + 1) % P.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
  // Sutherland-Hodgman: the subject polygon clipped by a convex polygon.
  function clipConvex(subject, clip) {
    const sgn = signedArea(clip) >= 0 ? 1 : -1;
    let out = subject;
    for (let i = 0; i < clip.length && out.length; i++) {
      const a = clip[i], b = clip[(i + 1) % clip.length];
      const inside = (p) => sgn * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) >= 0;
      const cut = (p, q) => {
        const x1 = p[0], y1 = p[1], x2 = q[0], y2 = q[1], x3 = a[0], y3 = a[1], x4 = b[0], y4 = b[1];
        const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4) || 1e-9, t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
        return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
      };
      const src = out; out = [];
      for (let j = 0; j < src.length; j++) {
        const p = src[j], q = src[(j + 1) % src.length], pi = inside(p), qi = inside(q);
        if (pi) out.push(p);
        if (pi !== qi) out.push(cut(p, q));
      }
    }
    return out;
  }
  // the part of a polygon above y (a half-plane clip)
  const above = (poly, y) => clipConvex(poly, [[-1e5, -1e5], [1e5, -1e5], [1e5, y], [-1e5, y]]);

  // ---------- materials ----------
  const cel = (base, shade, o) => Object.assign({ type: 8, ramp: [shade || base, shade || base, base, base], clean: true, lineW: 0, shadow: 0, rim: 0 }, o);
  const op = (pts, mat, seed, part) => ({ kind: "fill", pts, mat, seed, part, dyn: true });
  const INK = { iris: ["#6a3216", "#341609"], pupil: "#160a06", white: ["#fbfbfd", "#c6c9d6"], mouth: ["#5e1b1d", "#3e0f12"], tongue: ["#e98a84", "#c9625f"],
    teeth: "#fdfdfd", lip: "#4b2116", glasses: "#1c1517", blush: "#ff7d6b" };

  // ---------- eyes ----------
  const CLOSED = { closed: "closed", sleepy: "closed", happy: "happy", wink: "happy" };
  function eyeState(p, k, painted) {
    if (num(p.happy, 0) >= 0.5 || num(p["happy" + k], 0) >= 0.5) return "happy";
    return p["eye" + k] || p.eyes || painted || "open";
  }
  function eye(e, k, p, F, C, seed) {
    const [x0, y0, x1, y1] = e.box, w = x1 - x0, h = y1 - y0, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, u = C.u;
    const st = eyeState(p, k, F.paint.eyes), ops = [];
    const closed = own(CLOSED, st);
    if (closed) {
      const pts = closed === "happy"
        ? [[x0 + 0.06 * w, cy + 0.2 * h], [cx, cy - 0.2 * h], [x1 - 0.06 * w, cy + 0.16 * h]]
        : [[x0 + 0.04 * w, cy - 0.02 * h], [cx, cy + 0.22 * h], [x1 - 0.04 * w, cy - 0.04 * h]];
      ops.push(op(band(curve(pts), Math.max(0.75 * u, 0.075 * h), 0.3), cel(C.line), seed, "eyes"));
      return ops;
    }
    const wide = st === "wide", rx = (w / 2) * (wide ? 1.08 : 1), ry = (h / 2) * (wide ? 1.16 : 1);
    const sclera = ellipse(cx, cy, rx, ry, 44).map(([x, y]) => [x, y > cy ? cy + (y - cy) * 0.9 : y]);
    ops.push(op(sclera, cel(INK.white[0], INK.white[1], { shadow: 0.2 * ry, light: Math.PI / 2, line: C.line, lineW: 0.6 * u }), seed, "eyes"));
    const look = clamp(num(p["look" + k], num(p.look, 0)), -1, 1), lookY = clamp(num(p.lookY, 0), -1, 1);
    const ic = e.iris || [cx, cy], r = Math.min(num(e.irisR, 0.42 * h), 0.56 * h) * (wide ? 0.86 : 1);
    const c = [ic[0] + look * 0.26 * w, ic[1] + lookY * 0.22 * h];
    const iris = clipConvex(ellipse(c[0], c[1], r, r, 36), sclera);
    if (iris.length > 2) ops.push(op(iris, cel(INK.iris[0], INK.iris[1], { shadow: 0.45 * r, light: Math.PI / 2, line: "#2a1209", lineW: 0.4 * u }), seed + 1, "eyes"));
    const pupil = clipConvex(ellipse(c[0], c[1] + 0.05 * r, 0.56 * r, 0.6 * r, 28), sclera);
    if (pupil.length > 2) ops.push(op(pupil, cel(INK.pupil), seed + 2, "eyes"));
    ops.push(op(ellipse(c[0] - 0.34 * r, c[1] - 0.38 * r, 0.3 * r, 0.3 * r, 20), cel("#ffffff"), seed + 3, "eyes"));
    ops.push(op(ellipse(c[0] + 0.32 * r, c[1] + 0.34 * r, 0.13 * r, 0.13 * r, 14), cel("#ffffff"), seed + 4, "eyes"));
    // the upper lid: the mask's (or the skin's) colour coming down, its lash on its edge; open, the lash on the top
    const lid = Math.max(clamp(num(p["lid" + k], num(p.lid, 0)), 0, 1), st === "half" ? 0.5 : 0);
    const t = Math.max(0.9 * u, 0.09 * h);
    if (lid > 0.02) {
      // the lid covers the eye's outline too, down to its edge; closed, the lash rests low on the eye
      const cover = ellipse(cx, cy, rx + 1.2 * u, ry + 1.2 * u, 44).map(([x, y]) => [x, y > cy ? cy + (y - cy) * 0.9 : y]);
      const yl = cy - ry - 1.2 * u + lid * (1.9 * ry + 1.2 * u), lidPts = above(cover, lid > 0.97 ? cy + ry + 2 * u : yl);
      if (lidPts.length > 2) ops.push(op(lidPts, cel(C.lid), seed + 5, "eyes"));
      const half = (rx + 1.2 * u) * Math.sqrt(Math.max(0.05, 1 - ((yl - cy) / (ry + 1.2 * u)) ** 2));
      ops.push(op(band([[cx - half, yl], [cx, yl + 0.04 * h * (1 - lid)], [cx + half, yl]], t, 0.25), cel(C.line), seed + 6, "eyes"));
    } else {
      const top = [];
      for (let i = 0; i <= 16; i++) { const a = Math.PI * (1.04 + 0.92 * (i / 16)); top.push([cx + (rx + 0.2 * t) * Math.cos(a), cy + (ry + 0.25 * t) * Math.sin(a)]); }
      ops.push(op(band(top, t, 0.3), cel(C.line), seed + 6, "eyes"));
    }
    return ops;
  }

  // ---------- brows ----------
  // [inner end, outer end] moves in eye heights (+ = down); a sheet's brows are its painted state's, so the neutral
  // brow is the measured one less that state's move.
  const BROWS = { neutral: [0, 0], raised: [-0.25, -0.2], high: [-0.45, -0.35], flat: [0.08, 0.04], low: [0.15, 0.1], sleepy: [0.18, 0.12],
    angry: [0.38, -0.08], determined: [0.38, -0.08], worried: [-0.35, 0.12], sad: [-0.38, 0.14], curious: [-0.3, -0.42] };
  function brows(F, p, C) {
    const h = C.eyeH, cxF = C.midX, painted = BROWS[F.paint.brows] || BROWS.neutral, ops = [];
    (F.brows || []).forEach((b, i) => {
      if (b.length < 2) return;
      const k = (b[0][0] + b[b.length - 1][0]) / 2 < cxF ? "L" : "R";
      const want = own(BROWS, p["brow" + k] || p.brows) || (p["brow" + k] || p.brows ? BROWS.neutral : painted);
      const lift = -num(p.brow, 0) * 0.15 * h;
      const innerFirst = Math.abs(b[0][0] - cxF) < Math.abs(b[b.length - 1][0] - cxF);
      const pts = b.map(([x, y], j) => {
        const s = b.length > 1 ? j / (b.length - 1) : 0, si = innerFirst ? s : 1 - s;   // 0 at the inner end
        const dy = ((want[0] - painted[0]) * (1 - si) + (want[1] - painted[1]) * si) * h + lift;
        return [x, y + dy];
      });
      const ws = b.map((q) => Math.max(0.8 * C.u, q[2] / 2));
      const line = pts.length > 2 ? curve(pts, 4) : pts;
      const wl = line.map((_, j) => ws[Math.min(ws.length - 1, Math.round((j / Math.max(line.length - 1, 1)) * (ws.length - 1)))]);
      ops.push(op(band(line, wl, 0.3), cel(C.hair), 60 + i, "brows"));
    });
    return ops;
  }

  // ---------- mouth ----------
  const SMILES = { smile: 1, cat: 1, smile2: 1.2, sleepy: 0.6 };
  const OPEN = { open: 0.38, happy: 0.48, excited: 0.6, laugh: 0.62, grin: 0.24, tongue: 0.4 };
  function mouth(F, p, C) {
    const M = F.mouth;
    if (!M) return [];
    const span = C.span, u = C.u, ops = [];
    let l, r, m;
    if (M.c) {
      const hw = 0.38 * span;
      l = [M.c[0] - hw, M.c[1] - 0.22 * hw]; r = [M.c[0] + hw, M.c[1] - 0.22 * hw];
    } else { l = M.l; r = M.r; }
    const w = Math.hypot(r[0] - l[0], r[1] - l[1]), mc = [(l[0] + r[0]) / 2, (l[1] + r[1]) / 2];
    m = M.m || [mc[0], mc[1] + 0.07 * w];
    const paint = F.paint.mouth || "smile";
    let id = p.mouth && p.mouth !== "painted" ? p.mouth : paint;
    if (num(p.mouthRound, 0) > 0.3) id = "surprised";
    if (own(SMILES, id) && num(p.mouthOpen, 0) > 0.05) id = "open";
    const openK = own(OPEN, id);
    if (openK) {
      let depth = openK * w;
      if (M.bottom != null && own(OPEN, paint)) depth = (M.bottom - mc[1]) * (openK / OPEN[paint]);
      if (id === "open" && num(p.mouthOpen, 0) > 0.05 && !own(OPEN, p.mouth)) depth = num(p.mouthOpen, 0) * 0.5 * w;
      const top = mc[1] + 0.02 * depth, bot = [];
      for (let i = 0; i <= 18; i++) {
        const t = i / 18, x = r[0] + (l[0] - r[0]) * t, yEdge = r[1] + (l[1] - r[1]) * t;
        bot.push([x, yEdge + Math.sin(Math.PI * t) ** 0.8 * depth]);
      }
      const poly = [l, [mc[0], top], r, ...bot.slice(1, -1)];
      ops.push(op(poly, cel(INK.mouth[0], INK.mouth[1], { line: C.line, lineW: 0.7 * u }), 81, "mouth"));
      if (id !== "tongue") {
        const teeth = above(poly, Math.min(l[1], r[1]) + 0.24 * depth);
        if (teeth.length > 2) ops.push(op(teeth, cel(INK.teeth, "#d9dbe3", { shadow: 0.06 * depth, light: -Math.PI / 2 }), 82, "mouth"));
      }
      const tongue = clipConvex(ellipse(mc[0], mc[1] + (id === "tongue" ? 1.0 : 0.82) * depth, 0.3 * w, 0.32 * depth, 28), poly);
      if (tongue.length > 2) ops.push(op(tongue, cel(INK.tongue[0], INK.tongue[1], { shadow: 0.1 * depth, light: -Math.PI / 2 }), 83, "mouth"));
      return ops;
    }
    if (id === "o" || id === "surprised") {
      const rr = (M.o || 0.2 * w) * (id === "o" ? 0.75 : 1), c = M.c || [mc[0], mc[1] + 0.12 * w];
      const o = ellipse(c[0], c[1], rr, rr * 1.12, 32);
      ops.push(op(o, cel(INK.mouth[0], INK.mouth[1], { line: C.line, lineW: 0.7 * u }), 81, "mouth"));
      const tongue = clipConvex(ellipse(c[0], c[1] + 0.75 * rr, 0.7 * rr, 0.45 * rr, 24), o);
      if (tongue.length > 2) ops.push(op(tongue, cel(INK.tongue[0], INK.tongue[1]), 83, "mouth"));
      return ops;
    }
    // closed: one line through the corners, bent by the mouth's kind and by smile
    let dip = own(SMILES, paint) ? m[1] - mc[1] : 0.08 * w;
    if (own(SMILES, id)) dip *= SMILES[id] / (own(SMILES, paint) || 1);
    if (id === "frown" || id === "worried") dip = -0.08 * w;
    if (id === "grim") dip = 0;
    dip += num(p.smile, 0) * 0.07 * w;
    const corner = id === "grim" ? 0.02 * w : 0;
    const pts = curve([[l[0], l[1] + corner], [mc[0] + (m[0] - mc[0]), mc[1] + dip], [r[0], r[1] + corner]], 8);
    ops.push(op(band(pts, Math.max(0.5 * u, 0.02 * w), 0.4), cel(C.lip), 81, "mouth"));
    if (own(SMILES, id) || id === "grim") ops.push(op(ellipse(mc[0], Math.max(m[1], mc[1] + dip) + 0.17 * w, 0.1 * w, 0.032 * w, 20), cel(C.skinShade), 84, "mouth"));
    return ops;
  }

  // ---------- the whole face ----------
  const BLUSH = { soft: 0.35, bright: 0.8 };
  function face(F, p = {}, colours = {}) {
    const eyes = F.eyes || [];
    const span = eyes.length > 1 ? eyes[1].c[0] - eyes[0].c[0] : eyes.length ? 2.3 * (eyes[0].box[2] - eyes[0].box[0]) : 40;
    const eyeH = eyes.length ? eyes.reduce((s, e) => s + e.box[3] - e.box[1], 0) / eyes.length : 0.3 * span;
    const midX = eyes.length > 1 ? (eyes[0].c[0] + eyes[1].c[0]) / 2 : F.nose ? F.nose[0] : eyes.length ? eyes[0].c[0] : 0;
    const C = Object.assign({ line: "#1a1416", hair: "#2b2230", lid: "#f87a1a", skinShade: "#b97f5a", lip: INK.lip }, colours,
      { span, eyeH, midX, u: Math.max(0.6, span / 60) });
    const out = [];
    eyes.forEach((e, i) => out.push(...eye(e, eyes.length === 1 ? "L" : i === 0 ? "L" : "R", p, F, C, 70 + 10 * i)));
    if (F.nose) out.push(op(ellipse(F.nose[0], F.nose[1], 0.06 * span, 0.035 * span, 20), cel(C.noseShade || C.skinShade), 90, "face"));
    out.push(...mouth(F, p, C));
    const b = clamp(num(own(BLUSH, p.blush), num(p.blush, 0)), 0, 1);
    if (b > 0) eyes.forEach((e, i) => out.push({ kind: "halo", pts: ellipse(e.c[0] + (i ? 0.08 : -0.08) * span, e.box[3] + 0.32 * span, 0.24 * span, 0.12 * span, 24),
      tint: INK.blush, amt: 0.45 * b, mat: { soft: 0.08 * span, radius: 0.08 * span }, seed: 95 + i, part: "face", dyn: true }));
    const glasses = p.glasses != null ? !!p.glasses : !!F.paint.glasses;
    if (glasses && F.glasses) {
      const gw = Math.max(0.8 * C.u, 0.055 * F.glasses[0][2]);
      F.glasses.forEach(([x, y, r], i) => {
        const ring = ellipse(x, y, r, r, 48);
        out.push(op(band(ring.concat([ring[0]]), gw, 0), cel(INK.glasses), 100 + i, "face"));
      });
      if (F.glasses.length > 1) {
        const [a, c] = F.glasses;
        out.push(op(band(curve([[a[0] + a[2] * 0.97, a[1] - 0.25 * a[2]], [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2 - 0.4 * a[2]], [c[0] - c[2] * 0.97, c[1] - 0.25 * c[2]]], 6), gw * 0.9, 0), cel(INK.glasses), 103, "face"));
        out.push(op(band([[a[0] - a[2], a[1] - 0.3 * a[2]], [a[0] - 1.35 * a[2], a[1] - 0.4 * a[2]]], gw * 0.9, 0), cel(INK.glasses), 104, "face"));
        out.push(op(band([[c[0] + c[2], c[1] - 0.3 * c[2]], [c[0] + 1.35 * c[2], c[1] - 0.4 * c[2]]], gw * 0.9, 0), cel(INK.glasses), 105, "face"));
      }
    }
    return { brows: brows(F, p, C), face: out };
  }

  NS.face = face;
  NS.BROWS = BROWS;
  NS.geom = { ellipse, band, clipConvex, curve };
})();

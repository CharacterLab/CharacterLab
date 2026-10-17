// Part catalog for the Character Lab: every part of the character, its variants (each cut from a
// reference sheet), a WebGL renderer and a small animation. World units of a variant = pixels of its
// crop on the sheet (origin at the crop's top-left). The whole character keeps its traced world.
(function () {
  const CharacterLab = window.CharacterLab;
  const PT = CharacterLab.wcParts;
  const PAD = 6;
  // Every character's sheets come from its pack (js/lab-packs.js): an absolute path is used as it is, a bare file name
  // is resolved by the pack that knows it (registerCharacter's sheetUrl).
  const SHEETS = Object.assign({}, CharacterLab.WC_EXTRA_SHEETS);
  const sheetUrl = (key) => CharacterLab.lab.sheetUrl(SHEETS[key].file);

  const fitted = (id) => (CharacterLab.WC_ELEMENTS_DATA || {})[id];
  const traced = (id) => (CharacterLab.WC_PARTS_DATA || {})[id];
  const onPaper = (d, ops) => [PT.paper([[0, 0], [d.box[2], 0], [d.box[2], d.box[3]], [0, d.box[3]]]), ...ops];

  // ---------- builders: a pack's families of parts (one file per family, registered in CharacterLab.WC_FAMILIES) ----------
  // CharacterLab.WC_FAMILIES.<family> = { "<variant id>": fn, "<id prefix>*": fn }, fn(d, p, vv) -> ops (or null: nothing to draw).
  // d = the variant's traced data (wc-parts-data.js) or fitted leaves (wc-elements-data.js); the world is d.box's size,
  // or the variant's frame. An exact id always draws; a prefix draws only the variants that have data.
  const FAMILIES = () => Object.values(CharacterLab.WC_FAMILIES || {});
  function builderFor(id) {
    const hasData = !!(traced(id) || fitted(id));
    for (const fam of FAMILIES()) if (typeof fam[id] === "function") return fam[id];
    if (!hasData) return null;
    for (const fam of FAMILIES()) for (const [k, fn] of Object.entries(fam)) if (k.endsWith("*") && id.startsWith(k.slice(0, -1))) return fn;
    return null;
  }
  function familyBuild(vv) {
    const fn = builderFor(vv.id);
    if (!fn) return null;
    return (p) => {
      const d = traced(vv.id) || fitted(vv.id), ops = fn(d, p || {}, vv);
      return ops ? { ops, world: d && d.box ? [d.box[2], d.box[3]] : [vv.frame[2], vv.frame[3]] } : null;
    };
  }

  // ---------- small animations: an affine transform of the ops, or per-lobe sway ----------
  function opsBounds(ops) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    const add = ([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
    for (const op of ops) { (op.pts || []).forEach(add); ["a", "b", "c"].forEach((k) => op[k] && add(op[k])); }
    return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
  }
  // M = [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f
  const rotAbout = (th, px, py) => { const c = Math.cos(th), s = Math.sin(th); return [c, s, -s, c, px - c * px + s * py, py - s * px - c * py]; };
  const scaleAbout = (sx, sy, px, py) => [sx, 0, 0, sy, px - sx * px, py - sy * py];
  const then = (m, n) => [n[0] * m[0] + n[2] * m[1], n[1] * m[0] + n[3] * m[1], n[0] * m[2] + n[2] * m[3], n[1] * m[2] + n[3] * m[3], n[0] * m[4] + n[2] * m[5] + n[4], n[1] * m[4] + n[3] * m[5] + n[5]];
  // Materials whose own frame turns with the shape (wc-gl.js mat.rot, radians, + = clockwise on screen, about op.off):
  // the nut's grain and bark (type 3), the cap's lattice and dome (type 4), a pool's gradient axis (type 1 with grad).
  const turns = (m) => !!m && (m.type === 3 || m.type === 4 || (m.type === 1 && !!(m.grad || m.gradA)));
  // The ops under M (new ops; the old ones are left as they are). Sizes scale by s = √|det M| (a number, or [rx, ry]
  // element-wise); M's rotation (atan2, + = clockwise on screen, as rotAbout) is added to a turning material's rot.
  // opts.axes: an eye's radii scale along each axis (|M's columns|), so a rig pose can squash or stretch an eye.
  function transformOps(ops, M, opts) {
    const P = ([x, y]) => [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]];
    const V = ([x, y]) => [M[0] * x + M[2] * y, M[1] * x + M[3] * y];
    const s = Math.sqrt(Math.abs(M[0] * M[3] - M[1] * M[2])), th = Math.atan2(M[1], M[0]);
    const S = (v) => (Array.isArray(v) ? v.map((x) => x * s) : v * s);
    return ops.map((op) => {
      const o = Object.assign({}, op);
      if (o.pts) o.pts = o.pts.map(P);
      for (const k of ["a", "b", "c"]) if (o[k]) o[k] = P(o[k]);
      if (o.off) o.off = o.kind === "fill" ? P(o.off) : V(o.off);
      if (o.kind === "fill" && o.mat && o.mat.type === 3 && o.amt) o.amt *= s;
      if (o.kind === "almond" || o.kind === "almondshadow") o.w *= s;
      else if (o.mat && o.mat.type === 4 && o.w != null && Math.abs(s - 1) > 1e-9) o.w = S(o.w);   // the cap's dome radii
      if (o.kind === "eye") {
        o.r = opts && opts.axes ? [o.r[0] * Math.hypot(M[0], M[1]), o.r[1] * Math.hypot(M[2], M[3])] : o.r.map((v) => v * s); o.iris = V(o.iris);
        if (o.irisR != null) o.irisR = S(o.irisR);
        if (o.pupilR != null) o.pupilR = S(o.pupilR);
      }
      if (th && turns(o.mat)) o.mat = Object.assign({}, o.mat, { rot: (o.mat.rot || 0) + th });
      return o;
    });
  }
  // Each lobe swings a little about its base, out of phase with its neighbours (its shadow follows it).
  function sway(ops, t, amp = 0.045) {
    return ops.map((op) => {
      if (op.lobe == null) return op;
      const th = amp * Math.sin(t * 1.7 + op.lobe * 0.9), [ax, ay] = op.a, c = Math.cos(th), s = Math.sin(th);
      const [bx, by] = [op.b[0] - ax, op.b[1] - ay];
      return Object.assign({}, op, { b: [ax + c * bx - s * by, ay + s * bx + c * by] });
    });
  }
  const blinkAt = (t, period = 3.4) => { const ph = t % period; return ph < 0.18 ? Math.sin((ph / 0.18) * Math.PI) : 0; };
  // Each kind returns the animated ops (params reach the builder through build(p)).
  const ANIM = {
    none: { label: "", apply: (ops) => ops },
    blink: { label: "Blink and look around", params: (t) => ({ lid: blinkAt(t), look: 0.6 * Math.sin(t * 0.5), lookY: 0.25 * Math.sin(t * 0.31), brow: 0.18 * Math.sin(t * 0.7) }) },
    sway: { label: "Lobes sway on their bases", apply: (ops, t) => sway(ops, t) },
    wiggle: { label: "Nose wiggle", apply: (ops, t) => {
      const b = opsBounds(ops), ph = t % 2.4, burst = ph < 0.6 ? Math.sin((ph / 0.6) * Math.PI) : 0, w = Math.sin(t * 22) * burst;
      return transformOps(ops, scaleAbout(1 + 0.04 * w, 1 - 0.035 * w, b.cx, b.cy));
    } },
    talk: { label: "Mouth moves", apply: (ops, t) => {
      const b = opsBounds(ops), open = ops.length > 1;
      return transformOps(ops, open ? scaleAbout(1 + 0.03 * Math.sin(t * 5), 1 + 0.14 * Math.sin(t * 5), b.cx, b.y0) : scaleAbout(1 + 0.05 * Math.sin(t * 2.2), 1 - 0.06 * Math.sin(t * 2.2), b.cx, b.y0));
    } },
    pulse: { label: "Blush glows", apply: (ops, t) => ops.map((op) => (op.kind === "blush" ? Object.assign({}, op, { amt: op.amt * (1 + 0.2 * Math.sin(t * 2)) }) : op)) },
    tilt: { label: "Head tilts", apply: (ops, t) => { const b = opsBounds(ops); return transformOps(ops, rotAbout(0.04 * Math.sin(t * 1.3), b.cx, b.y1)); } },
    breathe: { label: "Breathing", apply: (ops, t) => { const b = opsBounds(ops), k = Math.sin(t * 1.8); return transformOps(ops, scaleAbout(1 - 0.006 * k, 1 + 0.02 * k, b.cx, b.y1)); } },
    waveL: { label: "Arm waves", apply: (ops, t) => { const b = opsBounds(ops); return transformOps(ops, rotAbout(0.12 * Math.sin(t * 3), b.x1 - b.w * 0.15, b.y0 + b.h * 0.3)); } },
    waveR: { label: "Arm waves", apply: (ops, t) => { const b = opsBounds(ops); return transformOps(ops, rotAbout(-0.12 * Math.sin(t * 3), b.x0 + b.w * 0.15, b.y0 + b.h * 0.3)); } },
    tap: { label: "Foot taps", apply: (ops, t) => { const b = opsBounds(ops), k = Math.max(0, Math.sin(t * 4)); return transformOps(ops, rotAbout(-0.07 * k, b.x0 + b.w * 0.15, b.y1)); } },
    raise: { label: "Brows lift", apply: (ops, t) => { const b = opsBounds(ops), k = Math.max(0, Math.sin(t * 1.6)); return transformOps(ops, then(rotAbout(-0.05 * k, b.cx, b.cy), [1, 0, 0, 1, 0, -0.18 * b.h * k])); } },
    bob: { label: "Prop bobs", apply: (ops, t) => { const b = opsBounds(ops); return transformOps(ops, then(rotAbout(0.05 * Math.sin(t * 2), b.cx, b.y0), [1, 0, 0, 1, 0, 1.5 * Math.sin(t * 2 + 0.6)])); } },
  };

  // ---------- masks: marks inside a crop that are not the element (a pack's masks, js/lab-packs.js) ----------
  const MASKS = Object.assign({}, CharacterLab.WC_EXTRA_MASKS);

  // ---------- the catalog ----------
  // v(id, label, sheet, box?) -> a variant; box = [x0, y0, x1, y1] on the sheet, or taken from fitted/traced data.
  function v(id, label, sheet, box) {
    const f = fitted(id), d = traced(id);
    const frame = f ? f.box : d ? d.box : [box[0] - PAD, box[1] - PAD, box[2] - box[0] + 2 * PAD, box[3] - box[1] + 2 * PAD];
    const vv = { id, label, sheet, frame };
    vv.build = familyBuild(vv);
    return vv;
  }
  const hi = (sheet, names, labels) => names.map((n, i) => v(`${sheet}-${n}`, labels[i], sheet));
  const PARTS = [];
  // The parts the packs registered (CharacterLab.WC_EXTRA_PARTS, js/lab-packs.js) and the ones a family adds (e.g. the
  // expressions in wc-expressions.js), in order. A part maker gets the catalog helpers and returns a part or a list.
  // A part belongs to a character (default: the first one registered); a whole-figure part (whole: true) takes the
  // face params, the lab's expression buttons and sliders.
  const helpers = { v, hi, SHEETS, transformOps, opsBounds, scaleAbout, rotAbout, then };
  for (const xp of CharacterLab.WC_EXTRA_PARTS || []) PARTS.push(...[].concat(typeof xp === "function" ? xp(helpers) : xp));
  const firstCharacter = ((CharacterLab.WC_CHARACTERS || [])[0] || {}).id;
  PARTS.forEach((p) => { p.character = p.character || firstCharacter; });
  const CHARACTERS = (CharacterLab.WC_CHARACTERS || []).filter((c) => PARTS.some((p) => p.character === c.id));
  PARTS.forEach((p) => p.variants.forEach((vv) => {
    vv.part = p.id;
    if (!vv.anim) vv.anim = p.anim === "wave" ? "waveL" : p.anim;
    if (!vv.mask && MASKS[vv.id]) vv.mask = MASKS[vv.id];
  }));

  const part = (id) => PARTS.find((p) => p.id === id);
  const variant = (pid, vid) => { const p = part(pid); return (p && (p.variants.find((x) => x.id === vid) || p.variants[0])) || null; };
  // The reference crop of a variant as a compare trace (the whole character keeps its own trace), with its mask.
  function trace(vv) {
    if (vv.kind === "trace") return vv.mask ? Object.assign({}, vv.trace(), { mask: vv.mask }) : vv.trace();
    const sheet = SHEETS[vv.sheet];
    if (!sheet) throw new Error(`variant ${vv.id}: unknown sheet "${vv.sheet}"`);
    // vv.scale (optional, e.g. 0.4): a big crop scored at that size; the variant's world is then its frame × scale
    const [x0, y0, w, h] = vv.frame;
    return Object.assign({ kind: "element", figure: Object.assign({ sheet: sheet.file, x0, y0, w, h }, vv.scale ? { scale: vv.scale } : {}) }, vv.mask ? { mask: vv.mask } : {});
  }
  // Build the variant at rest (t = null) or animated at time t (seconds).
  function build(vv, p = {}, t = null) {
    if (!vv.build) return null;
    const a = ANIM[vv.anim] || ANIM.none;
    const scene = vv.build(Object.assign({}, p, t != null && a.params ? a.params(t) : {}));
    if (!scene) return null;
    if (t != null && a.apply) scene.ops = a.apply(scene.ops, t);
    return scene;
  }
  const animLabel = (vv) => (ANIM[vv.anim] || ANIM.none).label;

  CharacterLab.wcElements = { parts: PARTS, part, variant, trace, build, animLabel, SHEETS, sheetUrl, sheetName: (vv) => SHEETS[vv.sheet].name, transformOps, onPaper, builderFor,
    characters: CHARACTERS, partsOf: (c) => PARTS.filter((p) => p.character === c) };
})();

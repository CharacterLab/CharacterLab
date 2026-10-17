// The rig: the parts an animation moves. A character's model tags every op with its part (op.part) and returns the
// rig with the scene (scene.rig = { def, pose }); def names each part's parent and pivot, and p.pose moves parts:
// { head: { rot: degrees (+ = clockwise), dx, dy: units, sx, sy: scale }, … }. A part turns and scales about its pivot,
// then moves, and carries its children (body > head > face > eyes…, as the pack's def says).
//   matrices(def, pose)  each part's world matrix [a, b, c, d, e, f] (x' = a x + c y + e, y' = b x + d y + f)
//   layers(scene)        the ops in drawing order, split for the studio's layered renderer (wc-gl.js renderRig):
//                        "over" (a part's still ops, drawn once into their own texture and laid over with the part's
//                        matrix), "mul" (the shadows a part casts on what lies below it: multiplied in), "dyn" (the
//                        animated features: eyes, brows, mouth, moved here and drawn every frame)
//   flatten(scene)       the scene with every op moved by its part's matrix: the exact still picture of a pose
//                        (filmstrips, scores). Without a pose the very same ops come back.
// Needs CharacterLab.wcElements.transformOps (js/wc-elements.js) once a pose moves something.
(function () {
  const CharacterLab = (window.CharacterLab = window.CharacterLab || {});
  const I = [1, 0, 0, 1, 0, 0];
  const MULTIPLY = new Set(["shadow", "blush", "almondshadow"]);
  const num = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);
  // m then n (n applied after m)
  const then = (m, n) => [n[0] * m[0] + n[2] * m[1], n[1] * m[0] + n[3] * m[1], n[0] * m[2] + n[2] * m[3], n[1] * m[2] + n[3] * m[3], n[0] * m[4] + n[2] * m[5] + n[4], n[1] * m[4] + n[3] * m[5] + n[5]];
  const isI = (m) => m === I || (m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0);
  function invert(m) {
    const det = m[0] * m[3] - m[1] * m[2] || 1e-9;
    return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
  }
  // A part's own move: scale and turn about its pivot, then move by (dx, dy).
  function local(pivot, q) {
    if (!q) return I;
    const th = (num(q.rot, 0) * Math.PI) / 180, sx = num(q.sx, 1), sy = num(q.sy, 1), dx = num(q.dx, 0), dy = num(q.dy, 0);
    if (!th && sx === 1 && sy === 1 && !dx && !dy) return I;
    const [px, py] = pivot || [0, 0], c = Math.cos(th), s = Math.sin(th);
    const a = c * sx, b = s * sx, cc = -s * sy, d = c * sy;
    return [a, b, cc, d, px - a * px - cc * py + dx, py - b * px - d * py + dy];
  }
  function matrices(def, pose) {
    const out = {};
    if (!def) return out;
    const world = (id, depth = 0) => {
      if (out[id]) return out[id];
      const node = def[id] || {}, own = local(node.pivot, pose && pose[id]);
      const parent = node.parent && depth < 16 ? world(node.parent, depth + 1) : I;
      out[id] = isI(parent) ? own : isI(own) ? parent : then(own, parent);
      return out[id];
    };
    for (const id of Object.keys(def)) world(id);
    return out;
  }
  const moved = (pose) => !!pose && Object.values(pose).some((q) => q && ["rot", "dx", "dy"].some((k) => num(q[k], 0)) || (q && (num(q.sx, 1) !== 1 || num(q.sy, 1) !== 1)));
  const transform = (ops, M) => (isI(M) ? ops : CharacterLab.wcElements.transformOps(ops, M, { axes: true }));

  // Layers in drawing order: consecutive ops of one part; a part's leading shadows (cast on what is below) are their
  // own "mul" layer; dyn ops are moved now and drawn as they are. Each still layer has a key that changes with its ops.
  function layers(scene) {
    const def = scene.rig && scene.rig.def, Ms = matrices(def, scene.rig && scene.rig.pose), out = [];
    let cur = null, n = 0;
    const close = () => { if (cur) { if (cur.mode !== "dyn") cur.key = JSON.stringify(cur.ops); out.push(cur); cur = null; } };
    for (const op of scene.ops) {
      const part = op.part || "", M = Ms[part] || I, mul = MULTIPLY.has(op.kind);
      // A shadow also darkens the layers below its part (a crown lobe's on the shell, a paw's on the belly): it is a
      // layer of its own, except in the bottom layer (the shell), whose own content is everything below it.
      const mode = op.dyn ? "dyn" : mul ? (cur && cur.part === part && cur.mode === "over" && !out.length ? "over" : "mul") : "over";
      if (!cur || cur.part !== part || cur.mode !== mode) { close(); cur = { id: `${part || "_"}#${n++}`, part, mode, M, ops: [] }; }
      cur.ops.push(op);
    }
    close();
    for (const L of out) if (L.mode === "dyn") L.ops = transform(L.ops, L.M);
    return out;
  }
  function flatten(scene) {
    const pose = scene.rig && scene.rig.pose;
    if (!moved(pose)) return scene;
    const Ms = matrices(scene.rig.def, pose);
    const ops = scene.ops.map((op) => {
      const M = Ms[op.part || ""];
      if (!M || isI(M)) return op;
      const o = transform([op], M)[0];
      if (!op.field) return o;
      // a lobe field's centre (op.field) moves and its rings scale with its part (its leaves keep their own lean)
      const f = op.field, s = Math.sqrt(Math.abs(M[0] * M[3] - M[1] * M[2]));
      return Object.assign(o, { field: Object.assign({}, f, { c: [M[0] * f.c[0] + M[2] * f.c[1] + M[4], M[1] * f.c[0] + M[3] * f.c[1] + M[5]],
        r0: f.r0 * s, dr: f.dr * s, len: f.len * s, wid: f.wid * s }) });
    });
    return Object.assign({}, scene, { ops });
  }

  CharacterLab.wcRig = { matrices, layers, flatten, local, then, invert, isIdentity: isI, moved };
})();

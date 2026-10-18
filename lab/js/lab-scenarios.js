// Scenarios: small scenes for testing a character in context (lab/scenarios.html). A scenario is a backdrop and props
// drawn by code from a few numeric params, plus the cast placed in it, so the page can scrub the params, sweep one of
// them, play the cast's clips and catch motion or fit bugs (feet that float or sink, a figure too big for its slot).
// The engine has no scene of its own: a pack registers its scenarios from one of its scripts (listed in its pack.json
// like any other), after its character:
//
//   CharacterLab.scenarios.register({
//     id: "pip-garden", label: "Garden path", pack: "pip",         // id: a-z, 0-9, -; unique among every pack's
//     world: [960, 600],                                            // the scene's size in its own units (y down)
//     params: { wind: { label: "Wind", min: 0, max: 1, step: 0.01, value: 0.3 },   // sliders: value is the default
//               lift: { min: 0, max: 120, step: 1, value: 0, unit: "u" } },
//     slots: [{ id: "path", label: "Path", x: 480, y: 470, w: 200 }],   // optional: where the cast stands; y is the floor
//     build(p, ctx) { return { ops, over }; },       // draw ops (wc-gl.js) behind the cast, and optional ops in front
//     draw(g, p, view) { … },                        // and/or 2D canvas drawing over the built ops, under the cast;
//                                                    // view = { scale, ox, oy, world, t } maps scene units to pixels
//     cast: [{ variant: "pip-front", slot: "path", h: 280, clip: "pip-bob" }],   // or cast(p, t) => [...]
//     notes: "What to look at.",                     // optional: shown under the scenario's name
//   });
//
// A cast member: { variant (a rigged or plain variant id), x, y (where its feet go, scene units) or slot (+ dx, dy),
//   h (its figure's height, scene units), p (face params), pose (rig pose, added under its clip's), clip (a clip id),
//   clipAt (seconds: hold that frame of the clip instead of following the page's time), flip (mirror it),
//   box ([x, y, w, h] in the variant's model units: the figure's box; default its crop), foot ([x, y] in model units:
//   the point set on (x, y); default its soles at rest under the box's centre), keepBackdrop (keep its own backdrop: by default the
//   leading fills that cover its whole world are left out, so the scene shows through) }.
//
//   register(def)              checks and adds a scenario (nothing is added unless the whole definition is valid)
//   list(pack?) / get(id)      the scenarios registered (a pack's)
//   params(sc, given)          every param's value: given ones clamped to their range, the rest at their default
//   sweep(spec, u)             a param swept min > max > min as u goes 0 > 1, with a sine ease
//   castOf(sc, p, t)           the cast at params p and time t, each member with its x, y resolved from its slot
//   place(variant, member)     where a member's figure goes: { k (scene units per model unit), box, foot, M (model >
//                              scene matrix [a, b, c, d, e, f]), rect ([x, y, w, h] in scene units) }; its feet are the
//                              lowest point the variant draws at rest (its soles), under the middle of its box
//   soleOf(ops)                the lowest point a list of ops draws (y, in their units), or null
//   pose(variant, member, t)   the member's scene at time t: its clip sampled (or held), mixed over p and pose, the rig
//                              flattened (wc-rig.js) and its backdrop left out: { ops, world }
//   frame(sc, p, t)            everything a page draws: { world, ops, over, slots, cast: [{ member, variant, scene,
//                              place, soles (the lowest point it draws now, scene y), gap (its soles above its slot's
//                              floor, scene units: 0 = standing on it, > 0 floating, < 0 sinking; null without a slot) }] }
//   clipLength(sc, p)          the longest clip the cast follows (seconds; 0 when none does)
// Needs js/wc-anim.js and js/wc-rig.js; castOf, pose and frame need js/wc-elements.js (the variants) once it is loaded.
(function () {
  const CharacterLab = (window.CharacterLab = window.CharacterLab || {});
  const ID = /^[a-z][a-z0-9-]*$/;
  const registry = new Map();

  const isObj = (x) => !!x && typeof x === "object" && !Array.isArray(x);
  const isFn = (x) => typeof x === "function";
  const finite = (...xs) => xs.every((x) => typeof x === "number" && Number.isFinite(x));
  const fail = (id, msg) => { throw new Error(`scenario "${id}": ${msg}`); };

  function checkParams(id, params) {
    if (!isObj(params)) fail(id, "params must map names to { min, max, step, value }");
    for (const [name, s] of Object.entries(params)) {
      if (!/^[A-Za-z][\w-]*$/.test(name)) fail(id, `bad param name ${JSON.stringify(name)}`);
      if (!isObj(s) || !finite(s.min, s.max, s.value)) fail(id, `param "${name}" needs numbers min, max and value`);
      if (!(s.max > s.min)) fail(id, `param "${name}": max must be above min`);
      if (s.value < s.min || s.value > s.max) fail(id, `param "${name}": value ${s.value} is outside ${s.min}..${s.max}`);
      if (s.step != null && !(finite(s.step) && s.step > 0)) fail(id, `param "${name}": step must be a number above 0`);
      if (s.label != null && typeof s.label !== "string") fail(id, `param "${name}": label must be text`);
      if (s.unit != null && typeof s.unit !== "string") fail(id, `param "${name}": unit must be text`);
    }
  }
  function checkSlots(id, slots) {
    if (!Array.isArray(slots)) fail(id, "slots must be a list of { id, x, y, w? }");
    const seen = new Set();
    for (const s of slots) {
      if (!isObj(s) || typeof s.id !== "string" || !s.id || !finite(s.x, s.y)) fail(id, "a slot needs an id and numbers x, y");
      if (seen.has(s.id)) fail(id, `slot "${s.id}" is named twice`);
      if (s.w != null && !(finite(s.w) && s.w > 0)) fail(id, `slot "${s.id}": w must be a number above 0`);
      seen.add(s.id);
    }
  }
  function check(def) {
    if (!isObj(def)) throw new Error("scenarios.register needs a scenario definition");
    const { id } = def;
    if (typeof id !== "string" || !ID.test(id)) throw new Error(`scenarios.register: bad id ${JSON.stringify(id)}`);
    if (registry.has(id)) fail(id, "registered twice");
    if (typeof def.label !== "string" || !def.label) fail(id, "needs a label");
    if (typeof def.pack !== "string" || !ID.test(def.pack)) fail(id, "needs the id of the pack it belongs to (pack)");
    if (!(Array.isArray(def.world) && def.world.length === 2 && finite(...def.world) && def.world.every((v) => v > 0))) fail(id, "world must be [width, height]");
    if (!isFn(def.build) && !isFn(def.draw)) fail(id, "needs build(p, ctx) or draw(g, p, view)");
    if (def.build != null && !isFn(def.build)) fail(id, "build must be a function");
    if (def.draw != null && !isFn(def.draw)) fail(id, "draw must be a function");
    checkParams(id, def.params == null ? {} : def.params);
    if (def.slots != null) checkSlots(id, def.slots);
    if (def.cast != null && !Array.isArray(def.cast) && !isFn(def.cast)) fail(id, "cast must be a list of members or cast(p, t)");
    if (Array.isArray(def.cast)) def.cast.forEach((m, i) => checkMember(id, m, i, def.slots || []));
    if (def.notes != null && typeof def.notes !== "string") fail(id, "notes must be text");
  }
  function checkMember(id, m, i, slots) {
    const at = `cast member ${i}`;
    if (!isObj(m) || typeof m.variant !== "string" || !m.variant) fail(id, `${at} needs a variant id`);
    if (!(finite(m.h) && m.h > 0)) fail(id, `${at} (${m.variant}) needs a height h above 0`);
    if (m.slot != null) {
      if (!slots.some((s) => s.id === m.slot)) fail(id, `${at} (${m.variant}) stands in slot "${m.slot}", which the scenario does not have`);
    } else if (!finite(m.x, m.y)) fail(id, `${at} (${m.variant}) needs x and y, or a slot`);
    for (const k of ["dx", "dy", "clipAt"]) if (m[k] != null && !finite(m[k])) fail(id, `${at} (${m.variant}): ${k} must be a number`);
    if (m.clip != null && typeof m.clip !== "string") fail(id, `${at} (${m.variant}): clip must be a clip id`);
    for (const k of ["p", "pose"]) if (m[k] != null && !isObj(m[k])) fail(id, `${at} (${m.variant}): ${k} must be an object`);
    for (const k of ["box", "foot"]) {
      const n = k === "box" ? 4 : 2;
      if (m[k] != null && !(Array.isArray(m[k]) && m[k].length === n && finite(...m[k]))) fail(id, `${at} (${m.variant}): ${k} must be ${n} numbers`);
    }
    if (m.box && !(m.box[2] > 0 && m.box[3] > 0)) fail(id, `${at} (${m.variant}): box needs a width and height above 0`);
  }

  function register(def) {
    check(def);
    const params = Object.fromEntries(Object.entries(def.params || {}).map(([k, s]) => [k, Object.freeze(Object.assign({ label: k, step: (s.max - s.min) / 100 }, s))]));
    const sc = Object.freeze(Object.assign({}, def, { params: Object.freeze(params), slots: Object.freeze((def.slots || []).map((s) => Object.freeze(Object.assign({}, s)))) }));
    registry.set(def.id, sc);
    return sc;
  }
  const list = (pack) => [...registry.values()].filter((s) => !pack || s.pack === pack);
  const get = (id) => registry.get(id) || null;
  const scenarioOf = (sc) => {
    const s = typeof sc === "string" ? get(sc) : sc;
    if (!s) throw new Error(`no such scenario: ${sc}`);
    return s;
  };

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function params(sc, given = {}) {
    const s = scenarioOf(sc), out = {};
    for (const [k, spec] of Object.entries(s.params)) {
      const v = given[k] == null || given[k] === "" ? NaN : Number(given[k]);
      out[k] = Number.isFinite(v) ? clamp(v, spec.min, spec.max) : spec.value;
    }
    return out;
  }
  const sweep = (spec, u) => spec.min + (spec.max - spec.min) * (0.5 - 0.5 * Math.cos(2 * Math.PI * u));

  // The cast at params p and time t, with each member's feet resolved (its slot's x, y plus dx, dy).
  function castOf(sc, p, t = 0) {
    const s = scenarioOf(sc), raw = isFn(s.cast) ? s.cast(p, t) : s.cast || [];
    if (!Array.isArray(raw)) fail(s.id, "cast(p, t) must return a list");
    return raw.map((m, i) => {
      checkMember(s.id, m, i, s.slots);
      const slot = m.slot != null ? s.slots.find((q) => q.id === m.slot) : null;
      const x = (slot ? slot.x : m.x) + (m.dx || 0), y = (slot ? slot.y : m.y) + (m.dy || 0);
      return Object.assign({}, m, { x, y, slotDef: slot });
    });
  }

  const elements = () => {
    const E = CharacterLab.wcElements;
    if (!E) throw new Error("scenarios: the variants are not loaded yet (js/wc-elements.js)");
    return E;
  };
  function variant(id) {
    const v = elements().parts.flatMap((p) => p.variants).find((x) => x.id === id);
    if (!v) throw new Error(`no such variant: ${id}`);
    if (!isFn(v.build)) throw new Error(`variant ${id} has no build(p) to draw it with`);
    return v;
  }
  // A variant's figure in its model units: a mapped crop's frame through its fit (sheet pixels for most packs), else
  // the frame's size at the origin.
  function modelBox(v) {
    const f = v.frame || [0, 0, 100, 100], fit = v.fit;
    if (v.kind === "mapped" && isObj(fit) && fit.s > 0) {
      const sc = v.scale || 1;
      return [-fit.tx / fit.s, -fit.ty / fit.s, (f[2] * sc) / fit.s, (f[3] * sc) / fit.s];
    }
    return [0, 0, f[2], f[3]];
  }
  // The lowest point the ops draw (their soles), in their own units; null when nothing has an outline.
  function soleOf(ops) {
    let y = -Infinity;
    for (const op of ops) if (op.pts && op.kind !== "shadow" && op.kind !== "clip") for (const q of op.pts) if (q[1] > y) y = q[1];
    return Number.isFinite(y) ? y : null;
  }
  const rest = new Map();   // variant id -> its soles at rest
  function restSole(v) {
    if (!rest.has(v.id)) {
      const scene = v.build({});
      rest.set(v.id, scene && Array.isArray(scene.ops) ? soleOf(backdropless(scene).ops) : null);
    }
    return rest.get(v.id);
  }
  function place(v, m) {
    const box = m.box || modelBox(v), sole = m.foot ? null : restSole(v);
    const foot = m.foot || [box[0] + box[2] / 2, sole != null && sole > box[1] ? sole : box[1] + box[3]];
    const k = m.h / box[3], sx = m.flip ? -k : k;
    const M = [sx, 0, 0, k, m.x - sx * foot[0], m.y - k * foot[1]];
    const x0 = M[0] * box[0] + M[4], x1 = M[0] * (box[0] + box[2]) + M[4];
    return { k, box, foot, M, rect: [Math.min(x0, x1), M[3] * box[1] + M[5], Math.abs(x1 - x0), box[3] * k] };
  }
  // The leading fills that cover the whole world: a figure's own backdrop.
  function backdropless(scene) {
    const [W, H] = scene.world || [0, 0];
    let n = 0;
    for (const op of scene.ops) {
      if (op.kind !== "fill" || !op.pts || op.dyn) break;
      const xs = op.pts.map((q) => q[0]), ys = op.pts.map((q) => q[1]);
      if (!(Math.min(...xs) <= 0 && Math.min(...ys) <= 0 && Math.max(...xs) >= W && Math.max(...ys) >= H)) break;
      n++;
    }
    return n ? Object.assign({}, scene, { ops: scene.ops.slice(n) }) : scene;
  }
  function pose(v, m, t = 0) {
    const A = CharacterLab.wcAnim, R = CharacterLab.wcRig;
    const clip = m.clip ? A.clips[m.clip] : null;
    if (m.clip && !clip) throw new Error(`no such clip: ${m.clip}`);
    const s = clip ? A.sample(clip, m.clipAt != null ? m.clipAt : t) : { p: {}, pose: {} };
    const scene = v.build(Object.assign({}, m.p || {}, s.p, { pose: A.addPose(m.pose || {}, s.pose) }));
    if (!scene || !Array.isArray(scene.ops)) throw new Error(`variant ${v.id}: build(p) returned no scene`);
    const flat = R.flatten(scene);
    return m.keepBackdrop ? flat : backdropless(flat);
  }
  function frame(sc, p, t = 0) {
    const s = scenarioOf(sc), built = s.build ? s.build(p, { world: s.world, t }) || {} : {};
    const cast = castOf(s, p, t).map((member) => {
      const v = variant(member.variant), at = place(v, member), scene = pose(v, member, t), sole = soleOf(scene.ops);
      const soles = sole == null ? null : at.M[3] * sole + at.M[5];
      const gap = member.slotDef && soles != null ? member.slotDef.y - soles : null;
      return { member, variant: v, scene, place: at, soles, gap };
    });
    return { world: s.world, ops: built.ops || [], over: built.over || [], slots: s.slots, cast };
  }
  function clipLength(sc, p) {
    const A = CharacterLab.wcAnim;
    return castOf(sc, p, 0).reduce((d, m) => (m.clip && m.clipAt == null && A.clips[m.clip] ? Math.max(d, A.clips[m.clip].dur) : d), 0);
  }

  CharacterLab.scenarios = Object.freeze({ register, list, get, params, sweep, castOf, place, pose, frame, clipLength, modelBox, backdropless, soleOf });
})();

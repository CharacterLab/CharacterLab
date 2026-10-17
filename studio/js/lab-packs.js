// Character packs: how a character joins the studio. A pack is a folder with a pack.json (id, label, license, the
// scripts the pages load, in order: ../packs/README.md) and scripts that end with one call:
//
//   CharacterLab.lab.registerCharacter({
//     id: "pip", label: "Pip", icon: "head",               // the character's button above the parts
//     sheetsBase: "/packs/pip/sheets/",                    // where its reference paintings are served from
//     sheets: { "pip-front": { file: "front.png", name: "front sheet" }, … },
//     parts: [part | (helpers) => part or [parts], …],     // the catalog entries (see js/wc-elements.js)
//     masks: { "<variant id>": [[x0, y0, x1, y1], …] },   // optional: marks in a crop that are not the element
//     // optional, for a character with a face and a rig:
//     expressions: { presets: { happy: { label: "Happy", p: { … } }, … }, mouths: { smile: "Smile", … },
//       build: (p) => scene, sliders: [[param, label, min, max], …], rest: { param: value at rest, … } },
//     rig: { parts: ["body", "head", …] },                // the rig parts a clip may move (scene.rig.def names them)
//     clips: [clip, …],                                   // animations (js/wc-anim.js: the clip format)
//     studio: { zooms: { "<variant id>": { full: [x, y, w, h], … } }, layers: ["body", …],
//       follow: { centre: [x, y], reach, layer: (gaze) => ({ p, pose }) },   // the studio's zooms, layer toggles,
//       filmZooms: { face: [x, y, w, h], … } },          // what the eyes-follow switch moves, anim.html's zooms
//     sheetUrl: (file) => url | null,                     // optional: where a sheet file without a sheetsBase lives
//   });
//
// Sheet keys are global, so a pack prefixes them with its id (or with its own prefix: prefix: "c2d-"). The first
// character registered is the studio's default. A part's character defaults to the pack's id. Packs load after the
// engine (geometry, renderer, scoring, parts, rig, clips, expressions, this file) and before js/wc-elements.js, which
// reads what they registered. Nothing is registered unless the whole definition is valid.
(function () {
  const CharacterLab = (window.CharacterLab = window.CharacterLab || {});
  const ID = /^[a-z][a-z0-9-]*$/;
  const registry = new Map();   // id -> { id, label, icon, expressions, rig, studio, sheetUrl }

  function fail(id, msg) { throw new Error(`character pack "${id}": ${msg}`); }
  const isObj = (x) => !!x && typeof x === "object" && !Array.isArray(x);
  const isFn = (x) => typeof x === "function";
  const strings = (a) => Array.isArray(a) && a.every((s) => typeof s === "string" && s);

  function checkExpressions(id, x) {
    if (!isObj(x)) fail(id, "expressions must be an object");
    if (!isObj(x.presets)) fail(id, "expressions.presets must be an object");
    for (const [name, e] of Object.entries(x.presets)) if (!isObj(e) || typeof e.label !== "string" || !isObj(e.p)) fail(id, `expression "${name}" needs a label and params p`);
    if (x.mouths != null && (!isObj(x.mouths) || !Object.values(x.mouths).every((s) => typeof s === "string"))) fail(id, "expressions.mouths must map ids to labels");
    if (x.build != null && !isFn(x.build)) fail(id, "expressions.build must be a function");
    if (x.rest != null && !isObj(x.rest)) fail(id, "expressions.rest must be an object");
    if (x.sliders != null && !(Array.isArray(x.sliders) && x.sliders.every((s) => Array.isArray(s) && s.length === 4 && typeof s[0] === "string" && typeof s[1] === "string" && Number.isFinite(s[2]) && Number.isFinite(s[3]))))
      fail(id, "expressions.sliders must be [param, label, min, max] rows");
  }
  function checkClips(id, clips, rigParts) {
    if (!Array.isArray(clips)) fail(id, "clips must be a list");
    const seen = new Set();
    for (const c of clips) {
      if (!isObj(c) || typeof c.id !== "string" || !(c.dur > 0)) fail(id, `a clip needs an id and dur > 0: ${JSON.stringify(c && c.id)}`);
      if (seen.has(c.id) || (CharacterLab.wcAnim && CharacterLab.wcAnim.clips[c.id])) fail(id, `clip id "${c.id}" is taken`);
      seen.add(c.id);
      if (rigParts) for (const part of Object.keys(c.pose || {})) if (!rigParts.includes(part)) fail(id, `clip "${c.id}" moves "${part}", which is not one of its rig parts`);
    }
    if (clips.length && !CharacterLab.wcAnim) fail(id, "clips need js/wc-anim.js loaded before the packs");
  }
  function checkStudio(id, s) {
    if (!isObj(s)) fail(id, "studio must be an object");
    if (s.zooms != null && !(isObj(s.zooms) && Object.values(s.zooms).every((z) => isObj(z) && Object.values(z).every((b) => Array.isArray(b) && b.length === 4 && b.every(Number.isFinite)))))
      fail(id, "studio.zooms must map variant ids to { name: [x, y, w, h] }");
    if (s.filmZooms != null && !(isObj(s.filmZooms) && Object.values(s.filmZooms).every((b) => Array.isArray(b) && b.length === 4 && b.every(Number.isFinite))))
      fail(id, "studio.filmZooms must map names to [x, y, w, h]");
    if (s.layers != null && !strings(s.layers)) fail(id, "studio.layers must be a list of layer names");
    if (s.follow != null && !(isObj(s.follow) && (s.follow.layer == null || isFn(s.follow.layer)))) fail(id, "studio.follow must be { centre, reach, layer }");
  }
  function check(def) {
    if (!def || typeof def !== "object") throw new Error("registerCharacter needs a character definition");
    const { id, label, sheets = {}, parts = [], sheetsBase = "", prefix = `${id}-` } = def;
    if (typeof id !== "string" || !ID.test(id)) throw new Error(`registerCharacter: bad id ${JSON.stringify(id)}`);
    if (registry.has(id)) fail(id, "registered twice");
    if (typeof label !== "string" || !label) fail(id, "needs a label");
    if (typeof sheetsBase !== "string") fail(id, "sheetsBase must be a string");
    if (typeof prefix !== "string") fail(id, "prefix must be a string");
    if (!Array.isArray(parts) || !parts.length) fail(id, "needs at least one part");
    for (const [key, s] of Object.entries(sheets)) {
      if (!key.startsWith(prefix)) fail(id, `sheet key "${key}" must start with "${prefix}"`);
      if (CharacterLab.WC_EXTRA_SHEETS && CharacterLab.WC_EXTRA_SHEETS[key]) fail(id, `sheet key "${key}" is already taken`);
      if (!s || typeof s.file !== "string" || typeof s.name !== "string") fail(id, `sheet "${key}" needs a file and a name`);
    }
    for (const [vid, boxes] of Object.entries(def.masks || {})) {
      if (!Array.isArray(boxes) || !boxes.every((b) => Array.isArray(b) && b.length === 4)) fail(id, `mask "${vid}" needs [x0, y0, x1, y1] boxes`);
      if (CharacterLab.WC_EXTRA_MASKS && CharacterLab.WC_EXTRA_MASKS[vid]) fail(id, `mask "${vid}" is already taken`);
    }
    parts.forEach((p, i) => { if (typeof p !== "function" && (!p || typeof p !== "object")) fail(id, `part ${i} is not a part`); });
    if (def.expressions != null) checkExpressions(id, def.expressions);
    if (def.rig != null && !(isObj(def.rig) && strings(def.rig.parts) && def.rig.parts.length)) fail(id, "rig needs a list of part names (rig.parts)");
    if (def.clips != null) checkClips(id, def.clips, def.rig && def.rig.parts);
    if (def.studio != null) checkStudio(id, def.studio);
    if (def.sheetUrl != null && !isFn(def.sheetUrl)) fail(id, "sheetUrl must be a function");
  }

  // A part that names no character belongs to the pack; a part maker gets the same treatment when it runs.
  const owned = (id, p) => (typeof p === "function"
    ? (ctx) => [].concat(p(ctx)).map((q) => Object.assign({ character: id }, q))
    : Object.assign({ character: id }, p));

  function registerCharacter(def) {
    check(def);
    const { id, label, icon, sheetsBase = "", sheets = {}, masks = {}, parts } = def;
    const files = Object.fromEntries(Object.entries(sheets).map(([key, s]) => [key, { file: sheetsBase + s.file, name: s.name }]));
    CharacterLab.WC_EXTRA_SHEETS = Object.assign({}, CharacterLab.WC_EXTRA_SHEETS, files);
    CharacterLab.WC_EXTRA_MASKS = Object.assign({}, CharacterLab.WC_EXTRA_MASKS, masks);
    CharacterLab.WC_CHARACTERS = [...(CharacterLab.WC_CHARACTERS || []), Object.assign({ id, label }, icon ? { icon } : {})];
    CharacterLab.WC_EXTRA_PARTS = [...(CharacterLab.WC_EXTRA_PARTS || []), ...parts.map((p) => owned(id, p))];
    registry.set(id, Object.freeze({ id, label, icon, expressions: def.expressions || null, rig: def.rig || null, studio: def.studio || null, sheetUrl: def.sheetUrl || null }));
    // clips last: adding one samples it, which needs the character's expressions (their rest values) registered
    if (def.clips && def.clips.length) CharacterLab.wcAnim.add(def.clips.map((c) => Object.assign({ character: id }, c)));
  }

  const characters = () => [...registry.values()];
  // The first character registered that defines `key` (the studio's default expressions, zooms…), or null.
  const firstWith = (key) => characters().find((c) => c[key]) || null;
  // A sheet file as a URL: an absolute path or URL as it is, else the first pack that knows the file, else the file.
  function sheetUrl(file) {
    if (typeof file !== "string" || file.startsWith("/") || /^[a-z]+:/i.test(file)) return file;
    for (const c of registry.values()) { const url = c.sheetUrl && c.sheetUrl(file); if (url) return url; }
    return file;
  }

  CharacterLab.lab = Object.assign({}, CharacterLab.lab, { registerCharacter, characterIds: () => [...registry.keys()], character: (id) => registry.get(id) || null,
    characters, firstWith, sheetUrl });
})();

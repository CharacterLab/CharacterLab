// Loads the character and material packs before the page goes on: reads /packs.json (the packs the server found:
// lab-config.mjs, each after the packs it requires) and writes their scripts into the page right here, in order, so
// they run before the scripts after this one (js/wc-elements.js reads what they registered). First every pack's
// renderer extensions (scripts named *-gl.js: CharacterLab.wcGL.registerMaterial / registerMode), so they are all registered
// before the first renderer is created; then the packs' other scripts. Place it after js/wc-gl.js and
// js/lab-packs.js, as a plain blocking <script>, before anything creates a renderer.
//   CharacterLab.lab.packs      the packs loaded: [{ id, label, kind, version, base, scripts }] (empty: none found, or no server)
// The manifest is read synchronously on purpose: the pages are plain scripts in order, and the packs belong
// between the engine and the catalog.
(function () {
  const CharacterLab = (window.CharacterLab = window.CharacterLab || {});
  const SAFE = /^\/packs\/[a-z][a-z0-9-]*\/$/, SCRIPT = /^(?!.*(^|\/)\.)[\w./-]+\.js$/;
  const isGL = (s) => /-gl\.js$/.test(s);
  let manifest = { packs: [], problems: 0 };
  try {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", "/packs.json", false);
    xhr.send();
    if (xhr.status === 200) manifest = JSON.parse(xhr.responseText);
    else console.warn(`Character Lab: /packs.json answered ${xhr.status}; no character packs loaded (npm start serves it)`);
  } catch (e) {
    console.warn("Character Lab: could not read /packs.json; no character packs loaded (npm start serves it).", e);
  }
  const packs = (manifest.packs || []).filter((p) => SAFE.test(p.base) && Array.isArray(p.scripts) && p.scripts.every((s) => SCRIPT.test(s)));
  if (manifest.problems) console.warn(`Character Lab: ${manifest.problems} pack(s) left out; the server's log says why.`);
  CharacterLab.lab = Object.assign({}, CharacterLab.lab, { packs: Object.freeze(packs.map((p) => Object.freeze(Object.assign({}, p)))) });
  const write = (p, s) => document.write(`<script src="${p.base}${s}"></script>`);
  for (const p of packs) for (const s of p.scripts.filter(isGL)) write(p, s);
  for (const p of packs) for (const s of p.scripts.filter((s) => !isGL(s))) write(p, s);
})();

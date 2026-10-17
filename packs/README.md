# Character packs

A character pack brings one character into the Character Lab: its parts, variants, builders, reference sheets and,
if it has them, its face (expressions), rig and animation clips. The engine (`../lab/js/`: renderer, lab,
scoring, rig and clip runtime) names no character; a pack reaches the engine only through
`CharacterLab.lab.registerCharacter()` (`../lab/js/lab-packs.js`) and the helpers it draws with (`CharacterLab.lab.geom`,
`CharacterLab.wcParts`, `CharacterLab.wcGL`).

This folder is the lab's own pack folder. It holds the open-source example pack, `captain-kite/` (Captain Kite, CC0:
a hero in a flat anime cel style, drawn with the engine's cel material; his shapes are traced from his sheets by
`captain-kite/tools/trace-sheets.py`), which loads with or without a `lab.config.json`. Your own characters can live
here too, or in a folder of their own outside the lab (a private repository, say) that `../lab.config.json` points at.

## Where the lab finds packs

`lab-config.mjs` reads, in order:

1. this folder (`packs/`);
2. the folders listed in `../lab.config.json` (optional), relative to the lab:
   `{ "packs": ["../my-character-packs"], "mounts": { "/sheets/": "../sheets/" } }` (see `../lab.config.example.json`)
   (`mounts`: other folders served read-only, e.g. where a pack's reference sheets live);
3. the folders in `LAB_PACKS` (colon-separated), e.g. `LAB_PACKS=~/my-packs npm start`.

Each subfolder with a `pack.json` is a pack. The server lists them at `GET /packs.json` and serves each one read-only at
`/packs/<id>/` (browser assets only; its `tests/`, `scripts/` and package files stay private). Every page loads them
through `../lab/js/lab-loader.js`, in `order`, then by folder, then by id: the first is the lab's default
character. A pack with a broken `pack.json`, or an id another folder already gave, is left out and named in the server's
log. With no packs at all the lab says "No character packs found".

## A pack

```
<id>/
  pack.json      { id, label, order, kind, requires, icon, icons, version, engine, license, private, description,
                   scripts: [...], sheetsBase }
  <id>.js        the character's code; the last script ends with one CharacterLab.lab.registerCharacter({...}) call
  tests/         its own tests, run by `npm test` with the engine's (at least: checkPack)
```

```js
CharacterLab.lab.registerCharacter({
  id: "pip", label: "Pip", icon: "head",                // the character's button above the parts
  sheetsBase: "/packs/pip/sheets/",                      // where its reference paintings are served from
  sheets: { "pip-front": { file: "front.png", name: "front sheet" } },
  parts: [ { id: "pip", label: "Whole", whole: true, variants: [...] }, () => ({ ... }) ],
  // optional
  masks: { "pip-front": [[0, 0, 20, 12]] },              // marks inside a crop that are not the element
  expressions: { presets, mouths, build, sliders, rest },   // the face: the lab's expression buttons and sliders
  rig: { parts: ["body", "head", "cap"] },               // the parts a clip may move
  clips: [ { id: "pip-bob", dur: 1.2, pose: { cap: { dy: [[0, 0], [0.6, -2], [1.2, 0]] } } } ],
  lab: { zooms, layers, follow, filmZooms },             // the lab's zooms, layer toggles, gaze; anim.html's zooms
  sheetUrl: (file) => url | null,                        // a sheet named by a bare file name (e.g. a trace's)
});
```

- `pack.json`'s `id` is its folder's name; `scripts` are `.js` paths inside the pack, loaded in that order.
- Icons: the lab ships neutral icons only (head, eye, nose, mouth, body, …, and `figure`, the default). A pack may
  ship its own SVGs (single-colour, drawn in black; the lab tints them): `"icon": "icon.svg"` for the character
  (its button, and any of its parts whose icon the lab does not have), `"icons": { "wing": "icons/wing.svg" }`
  for the icon names its parts use.
- Sheet keys and variant ids start with the pack's id, or with a `prefix` the pack names (e.g. `prefix: "p2-"`).
- A part's `character` defaults to the pack's id. A part maker may return a list of parts.
- A whole figure scored with landmarks (`kind: "trace"`) gives its trace a `scorer` (`../lab/js/wc-compare.js`);
  a variant with named regions (`regions`) can be measured part by part (`score.html?regions`, `inspect.html`).
- `sheetsBase` in the script and in `pack.json` agree. Sheets are served, never copied into the pack.
- Everything is checked before anything is registered (`../tests/packs.test.mjs` lists the rules).

## Renderer extensions and material packs

The renderer (`../lab/js/wc-gl.js`) carries only generic materials (the painted wash, pools, cel, eyes, blush,
halo, strokes). A pack's own look is a renderer extension: a script named `*-gl.js` that calls
`CharacterLab.wcGL.registerMaterial()` / `registerMode()` (documented at the top of `wc-gl.js`) with GLSL chunks the engine
splices into its shader before it compiles. The loader writes every pack's `*-gl.js` scripts first, before the packs'
other scripts and before anything creates a renderer, so they are all registered in time.

- A **materials pack** (`"kind": "materials"` in `pack.json`) has only `*-gl.js` scripts and registers no character.
- `"requires": ["<id>"]` loads a pack after the ones it needs (and leaves it out, named in the log, if one is missing):
  e.g. a cast whose characters share one materials pack for their common look, each with its own `<id>-gl.js` too.
- `checkPack` checks a materials pack too: its extensions register and compose, and it registers no character.

## Adding a pack

1. Make `<id>/` in a pack folder (this one, or one named in `lab.config.json`) with `pack.json` and its scripts.
2. Add `tests/pack.test.mjs`: `checkPack(dir)` from `../lab/scripts/lab-vm.mjs` checks the manifest, the scripts
   and the registration; `loadLab({ packs: [dir] })` loads the engine and the pack in a vm for more tests.
3. If its sheets live outside the pack, mount their folder in `lab.config.json`.
4. `npm test`, then `npm start`: the lab shows its button.

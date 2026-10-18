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
3. the folders in `LAB_PACKS` (colon-separated), e.g. `LAB_PACKS=~/my-packs npm start`;
4. the folder new packs are made in, if it is not one of those: `"newPacksDir"` in `../lab.config.json`, or
   `LAB_NEW_PACKS` (the lab's New character page and `POST /api/characters` make packs there; default: this folder).

Each subfolder with a `pack.json` is a pack. The server lists them at `GET /packs.json` and serves each one read-only at
`/packs/<id>/` (browser assets only; its `tests/`, `scripts/` and package files stay private). Every page loads them
through `../lab/js/lab-loader.js`, in `order`, then by folder, then by id: the first is the lab's default
character. A pack with a broken `pack.json`, or an id another folder already gave, is left out and named in the server's
log. With no packs at all the lab says "No character packs found".

## A pack

```
<id>/
  pack.json      { id, label, order, kind, requires, icon, icons, thumb, version, engine, license, private, description,
                   scripts: [...], sheetsBase }
  <id>.js        the character's code; one script calls CharacterLab.lab.registerCharacter({...}) once
                 (scripts after it may register scenarios: see Scenarios below)
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
- `thumb`: the picture on the character's card on the home page (a `.png`, `.jpg` or `.webp` path inside the pack);
  without one, `sheets/front.png`, else the first picture in `sheets/`.
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

## Scenarios

A scenario tests the cast in context on the lab's Scenarios page (`/lab/scenarios.html`): a small scene drawn by code
from numeric params, with characters placed in it, to scrub and sweep the params, play the clips and catch motion or
fit bugs (feet that float or sink, a figure too big for its place). A pack registers its scenarios from one of its own
scripts, listed in `pack.json` after the script that registers its character; the engine draws no scene of its own
(`../lab/js/lab-scenarios.js` documents every field). Captain Kite's `captain-kite/kite-rooftop.js` is an example.

```js
CharacterLab.scenarios.register({
  id: "pip-garden", label: "Garden path", pack: "pip",   // id: unique among every pack's scenarios
  world: [960, 600],                                      // the scene's size in its own units, y down
  params: { wind: { label: "Wind", min: 0, max: 1, step: 0.01, value: 0.3 },   // value: the default
            lift: { min: 0, max: 120, step: 1, value: 0, unit: "u" } },
  slots: [{ id: "path", label: "Path", x: 480, y: 470, w: 200 }],   // where the cast stands; y is the floor
  build: (p, ctx) => ({ ops: [...], over: [...] }),      // draw ops behind the cast, and in front of it (ctx: world, t)
  draw: (g, p, view) => { … },                           // or 2D canvas drawing, under the cast (view: scale, ox, oy)
  cast: (p, t) => [{ variant: "pip-front", slot: "path", dy: -p.lift, h: 280, clip: "pip-bob" }],   // or a list
  notes: "What to look at.",
});
```

- A cast member stands with its **soles** (the lowest point its variant draws at rest, under the middle of its crop) on
  `x, y`, or on its slot plus `dx, dy`, scaled so its crop is `h` tall. `p` and `pose` set its face and rig, `clip`
  plays a clip (`clipAt` holds one frame), `flip` mirrors it; `box` and `foot` override its box and feet (model units).
- Its own backdrop (the leading fills covering its whole world) is left out, so the scene shows through
  (`keepBackdrop: true` keeps it).
- The page reports each member's **gap**: its soles above its slot's floor (0 standing, more floating, less sinking).
  `CharacterLab.scenarios.frame(sc, params, t)` gives the same numbers in a test, without a GPU (`loadLab`).
- Open one at `/lab/scenarios.html?s=<id>&<param>=<value>&t=<seconds>`; `sweep=<param>` starts a sweep.

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

The quickest start is the lab's New character page (`/lab/new.html`) or `npm run new-pack` (`../AGENTS.md`), which
make all of this from one or more pictures. By hand:

1. Make `<id>/` in a pack folder (this one, or one named in `lab.config.json`) with `pack.json` and its scripts.
2. Add `tests/pack.test.mjs`: `checkPack(dir)` from `../lab/scripts/lab-vm.mjs` checks the manifest, the scripts
   and the registration; `loadLab({ packs: [dir] })` loads the engine and the pack in a vm for more tests.
3. If its sheets live outside the pack, mount their folder in `lab.config.json`.
4. `npm test`, then `npm start`: the lab shows its button.

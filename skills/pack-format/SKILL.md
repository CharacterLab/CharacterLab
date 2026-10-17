---
name: pack-format
description: Reference for Character Lab character packs - the files in a pack, pack.json fields, the registerCharacter call, sheets and variants (crops of a picture), renderer extensions, and keeping private characters outside the repository with lab.config.json or LAB_PACKS. Use when editing a pack's files or manifest, adding sheets or variants, or when the user wants their characters kept private or in another folder.
---

# Character packs

The complete reference is `packs/README.md` in the lab; this is the summary.

## Files

```
<id>/
  pack.json          the manifest
  <id>.js            the character's code; its last script calls CharacterLab.lab.registerCharacter({...})
  sheets/front.png   the reference pictures (served, never drawn into the character)
  tests/pack.test.mjs   checkPack(...): run by npm test
```

## pack.json

```json
{ "id": "star-girl", "label": "Star Girl", "version": "0.1.0", "engine": ">=0.1.0", "license": "UNLICENSED",
  "private": true, "description": "Star Girl, drawn in code.", "scripts": ["star-girl.js"],
  "sheetsBase": "/packs/star-girl/sheets/" }
```

- `id`: the folder's name; lowercase letters, digits, dashes. `scripts`: loaded in order. Optional: `order` (lower
  loads first; the first is the lab's default character), `icon` (an SVG in the pack), `requires` (pack ids to load
  first), `kind: "materials"` (renderer extensions only).
- `license`: the pack's own. Only include pictures the user has the rights to.

## registerCharacter

```js
CharacterLab.lab.registerCharacter({
  id: "star-girl", label: "Star Girl",
  sheetsBase: "/packs/star-girl/sheets/",
  sheets: { "star-girl-front": { file: "front.png", name: "Star Girl front sheet" } },
  parts: [{ id: "star-girl", label: "Whole", whole: true, variants: [
    { id: "star-girl-front", label: "Front", sheet: "star-girl-front", kind: "mapped",
      frame: [x, y, w, h], scale: 1, fit: { s: 1, tx: -x, ty: -y }, build } ] }],
  // optional: expressions, rig, clips (skill animate-character), masks
});
```

- A **variant** is one crop (`frame`, in the sheet's pixels) of one sheet plus the `build` that draws it; `fit` maps the
  sheet's pixels onto the crop. One variant per view, expression or pose; each is scored.
- Sheet keys and variant ids start with the pack id (or a `prefix` the pack names).
- To add a view: put the picture in `sheets/`, add it to `sheets`, add a variant with its own `frame`.

## Where packs live, and private characters

The lab loads packs from, in order: its own `packs/` folder, the folders listed in `lab.config.json`, and the folders
in `LAB_PACKS` (colon-separated). Each subfolder with a `pack.json` is a pack.

To keep a character private (not in the lab's repository), put it in a folder of its own, e.g. `../my-characters/`
(a private repository is ideal):

- with the tools: `create_character` with `dir: "../my-characters"`; it lists the folder in `lab.config.json` for you;
- by hand: `npm run new-pack -- <id> --sheet=... --dir=../my-characters`, then copy `lab.config.example.json` to
  `lab.config.json` and set `"packs": ["../my-characters"]`.

`lab.config.json` is git-ignored: never commit it. When the lab runs as an installed plugin, new characters go to
`~/character-lab/characters/` unless `dir` says otherwise.

## Renderer extensions

A look the engine lacks is a pack script named `*-gl.js` that calls `CharacterLab.wcGL.registerMaterial()` or
`registerMode()` with GLSL (documented at the top of `lab/js/wc-gl.js`). Never edit the engine for one character.

## Check a pack

`npm test` runs every pack's tests; `checkPack(dir)` from `lab/scripts/lab-vm.mjs` checks the manifest, the scripts and
the registration.

# Instructions for code assistants

This file is for AI code assistants (Claude Code, Codex, Cursor, …) working in this repository. `CLAUDE.md` points
here. People can read `README.md` instead.

Character Lab draws characters in code (WebGL2) and scores each drawing against a reference picture. A character is a
**pack**: a folder with `pack.json`, its scripts and its reference sheets. The engine lives in `studio/` and never
names a character.

## Install and check

Requires Node.js 22.12+ and Google Chrome (or Chromium) for headless scoring. Check both first: `node --version`, and
look for Chrome in its usual place. If Chrome is somewhere else, set `CHROME=/path/to/chrome`. If either is missing,
tell the user what to install rather than installing system software yourself.

If the user pasted a prompt from the README, it already says what they want: do it, then reply with what you made,
the scores and the studio link.

```bash
npm ci
npm test                    # must pass before and after your change
npm run lab -- score        # every variant's score (headless Chrome); Captain Kite's mean is about 82.7
npm start                   # http://localhost:8765/studio/ for the user to look at
```

`npm start` runs a server: start it in the background and give the user the URL.

## Add a character (the usual request)

Follow these steps in order. Each step ends with a command that shows whether it worked.

### 1. Get a reference sheet

You need a PNG of the character on a plain, flat background, ideally square (1024×1024 works well), front view, full
body, with nothing cropped. If the user hasn't got one:
- Ask them for one, or generate one with an image tool you have.
- The flat style matches the built-in cel material best: flat colours, one hard shadow, clean outlines.
- Find the figure's box on the sheet (`x,y,w,h` in pixels, a few pixels of margin). Measure it: crop and look, or
  scan for pixels that differ from the background colour.

### 2. Scaffold the pack

```bash
npm run new-pack -- <id> --sheet=<path/to/front.png> --box=x,y,w,h --label="Display Name"
```

- `<id>`: lowercase letters, digits and dashes (`star-girl`).
- This makes `packs/<id>/`: `pack.json`, `<id>.js` (one whole-figure variant with a placeholder ellipse),
  `sheets/front.png` and `tests/pack.test.mjs`.
- `--dir=<folder>` puts the pack outside the repo (for a private character). The lab then needs `LAB_PACKS=<folder>`
  or a `lab.config.json`; see step 6.

Check it worked: `npm test` passes, and `npm run lab -- score --part=<id>` prints one score (low: it's a placeholder).

### 3. Draw the character in code

Edit `packs/<id>/<id>.js`. `build(p)` returns `{ world, ops }`: draw ops in the sheet's own pixels, back to front.

- **Shapes:** `{ kind: "fill", pts, mat, seed }`. `pts` is a closed list of `[x, y]`. Make them with
  `CharacterLab.lab.geom.ellipse(cx, cy, rx, ry, rot)` or `spline(points, true)` through points you measured on the sheet.
- **Material:** the cel material, `{ type: 8, ramp: [shadow, shadow, base, base], line, lineW, shadow, clean: true }`.
  Other op kinds and materials (`eye`, `blush`, `halo`, strokes, the painted wash) are documented at the top of
  `studio/js/wc-gl.js`.
- **Order:** backdrop first, then body, limbs, head, hair, then face details last.
- **Measuring:** take every coordinate and colour from the sheet. Sample colours from flat regions; never guess them.

Work part by part: silhouette first, then big colour regions, then the face.

### 4. Measure, look, repeat

```bash
npm run lab -- score --part=<id> --save=out/<id>-base.json      # baseline
# …change the drawing…
npm run lab -- score --part=<id> --compare=out/<id>-base.json   # did it improve?
npm run lab -- sheet --v=<id>-front --out=out/<id>.png          # painting | code | difference
```

Open the `sheet` image after each change: the difference panel is white where the drawing matches, coloured where it
misses. Fix the biggest coloured areas first.

As a rough guide, about 80 or more is a good whole figure (Captain Kite's front is 88). Stop when the user is happy, not
at a number.

### 5. Add more (only if asked)

- **More views:** add another sheet to `sheets` and another variant with its own `frame` crop. Use one variant per
  expression or pose.
- **Expressions:** read params in `build(p)`, e.g. `p.eyes === "closed"`, `p.mouth === "open"`. Add an `expressions`
  block so the studio shows buttons and sliders.
- **Animation:** add `rig` (the parts a clip may move) and `clips`, then preview with
  `npm run lab -- film --clip=<clip-id>`.

`packs/captain-kite/` does all of these; copy its patterns. `packs/README.md` documents every field of `pack.json` and
`registerCharacter`.

### 6. A character kept outside this repo

For a private character, create it with `--dir=../my-characters`, then either:

```bash
LAB_PACKS=../my-characters npm start
```

or copy `lab.config.example.json` to `lab.config.json` (git-ignored) and list the folder under `packs`. Its pack tests
run with `npm test` the same way.

## Rules

- **The engine stays generic.** Don't put character-specific code, names or colours in `studio/`. Everything about a
  character goes in its pack. A look a pack needs that the engine lacks is a renderer extension (`*-gl.js`, see
  `packs/README.md`), not an engine edit.
- **Draw, don't copy.** Never draw the reference image itself, or pixels or textures sampled from it, to raise a
  score. The score must measure code against the painting. Measuring positions, outlines and flat colours on the sheet
  is fine.
- **Keep ids prefixed.** Variant ids and sheet keys start with the pack id (`star-girl-front`).
- **Pass the checks.** `npm test` must pass and other packs' scores must not change: compare with a baseline saved
  before your change.
- **Mind the license.** A pack carries its own `license` in `pack.json`. Only add sheets the user has the rights to.
- **Never commit** `out/`, `node_modules/` or `lab.config.json`.

## Where things are

| Path | What |
|------|------|
| `studio/` | the engine: pages, `js/` (renderer `wc-gl.js`, pack API `lab-packs.js`, loader), `scripts/` (CLI `wc-lab.mjs`, `new-pack.mjs`) |
| `packs/` | packs that ship with the lab; `packs/README.md` is the pack format |
| `packs/captain-kite/` | the full example: several sheets, parts, expressions, poses, rig, clips |
| `examples/blob/` | the smallest working pack (the README's guide) |
| `server.mjs`, `lab-config.mjs` | local server and pack discovery (`packs/`, `lab.config.json`, `LAB_PACKS`) |
| `tests/` | engine tests; each pack has its own `tests/` |

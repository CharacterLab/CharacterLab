<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/logo-wordmark-dark.svg">
    <img src="docs/brand/logo-wordmark-light.svg" alt="Character Lab" height="80">
  </picture>
</h1>

Draw characters in code, and measure how close you got.

Character Lab is an open-source (MIT) lab for drawing 2D characters entirely in code, with a WebGL2 renderer and no
images at render time, and scoring each drawing part by part against its reference picture. It is for developers,
technical artists and AI coding agents (Claude Code, Codex and others) who want to turn a character sheet into code.
It runs locally with Node.js and Google Chrome: the painted sheet sits next to the live code drawing, and after each
change to the code a 0–100 fidelity score shows whether the drawing got closer.

![The lab's home: create a new character or try the sample](docs/images/home.png)

It ships with one example character, **Captain Kite**, whose code and sheets you're free to use.

## Quick start

```bash
git clone https://github.com/CharacterLab/CharacterLab.git
cd CharacterLab
npm ci
npm start                # open http://localhost:8765/
```

Needs **Node.js 22.12+** and, for command-line scoring, **Google Chrome**. In Claude Code, add it as a plugin instead:
`/plugin marketplace add CharacterLab/CharacterLab` then `/plugin install character-lab@character-lab`. More in
[Install and run](#1-install-and-run).

## Features

- **Characters drawn only in code**: a WebGL2 renderer (no libraries) draws layers of SDF shapes with materials
  (painted wash, soft pools, cel, eyes, blush, halos, strokes). No images are used at render time.
- **The sheet next to the code**: the lab shows the reference painting beside the live WebGL drawing, by part
  (whole figure, parts, expressions, poses) and variant.
- **Five compare modes**: side by side, onion, difference, wipe and blink.
- **A fidelity score (0–100) per variant**, from silhouette, landmarks, palette, feature shapes, structure (SSIM) and
  texture. Save a baseline, change the code, and compare per variant.
- **Faces, rigs and clips**: face params (eyes, lids, gaze, brows, mouth, blush) as presets and sliders in the lab, a
  rig of parts, and clips such as a wave, shown as a filmstrip.
- **New character page**: drop in pictures, check the figure box it finds, and get a pack with a placeholder drawing
  and its first score (also `npm run new-pack`).
- **A pack format** for your own characters, with a checker (`checkPack`), packs kept in any folder or private repo,
  and custom GLSL materials and draw modes per pack.
- **A command line** for scores, painting | code | difference images, screenshots and filmstrips, in headless Chrome.
- **Made for AI agents**: plugins for Claude Code and Codex, five Agent Skills and an MCP server (`lab_start`,
  `lab_status`, `list_characters`, `create_character`, `score`, `compare`, `film`).
- **A sample character, Captain Kite** (26 variants over six reference sheets, a rig and two clips), and a minimal
  tutorial character, Blob. Both are CC0.

## Get started: just ask your agent

You don't need to learn any commands. Your AI agent installs the lab, creates your character and opens it for you.

### 1. Add the lab to your agent

| Agent | Type this in the agent |
|-------|------------------------|
| **Claude Code** | `/plugin marketplace add CharacterLab/CharacterLab` then `/plugin install character-lab@character-lab` |
| **Codex** | `codex plugin marketplace add CharacterLab/CharacterLab` then `codex plugin add character-lab@character-lab` |
| **Any other agent** (Cursor, …) | nothing: paste a prompt from step 2, starting with *"Clone https://github.com/CharacterLab/CharacterLab.git and read AGENTS.md."* |

The plugin brings the lab's [skills](skills/) and its tools (an [MCP server](mcp/)): your agent can start the lab,
create a character from your pictures, score it and show you comparisons.

### 2. Ask, in your own words

```text
Install Character Lab and show me the sample character.
```

```text
Add my character to Character Lab from this picture: /path/to/my-character.png
Call him "Max". Draw him in code until he looks right, then open him in the lab.
```

```text
I don't have a picture yet. Make a reference picture of a friendly robot girl with a red scarf,
then add her to Character Lab and show me the lab.
```

Your agent checks that Node.js 22.12+ and Google Chrome are installed, and tells you if something is missing.

### Or do it yourself in the lab

Open the lab, press **New character**, drop in your pictures, check the crop it found and press **Create**:

![New character: name it, drop in pictures, adjust the crop](docs/images/new-character.png)

The lab makes the pack and opens it next to your picture with its first score. It starts as a placeholder shape, and
your agent (or you, in code) then draws the character to match:

![A new character in the lab: the picture, a placeholder drawing and its score](docs/images/new-character-created.png)

Or press **Try the sample** to look around with Captain Kite:

![The lab: the reference sheet on the left, the character drawn in code on the right](docs/images/lab.png)

See [Install and run](#1-install-and-run) to run it without an agent.

---

## Contents

1. [Install and run](#1-install-and-run)
2. [A tour of the lab](#2-a-tour-of-the-lab)
3. [Meet Captain Kite](#3-meet-captain-kite)
4. [Guide: make your own character](#4-guide-make-your-own-character)
5. [Keep your characters in their own repository](#5-keep-your-characters-in-their-own-repository)
6. [Give a character its own look](#6-give-a-character-its-own-look)
7. [Command line reference](#7-command-line-reference)
8. [Folder map](#8-folder-map)
9. [FAQ](#9-faq)
10. [License](#10-license)

---

## 1. Install and run

You need **Node.js 22.12+** and, for command-line scoring, **Google Chrome** (set `CHROME=/path/to/chrome` if it isn't in
the usual place).

```bash
git clone https://github.com/CharacterLab/CharacterLab.git
cd CharacterLab
npm ci
npm start          # open http://localhost:8765/
```

The home page offers two ways in: **Create a new character** from your own pictures, or **Try the sample**, Captain
Kite, in the lab at <http://localhost:8765/lab/>. To check everything works:

```bash
npm test                 # the engine's tests and every pack's own tests
npm run lab -- score     # every variant's score, in headless Chrome
```

To start a character of your own from a picture, use the lab's **New character** page
(<http://localhost:8765/lab/new.html>): name it, drop in one or more pictures (the first is the front), check the
crop the lab found, and press Create. The same from the command line:

```bash
npm run new-pack -- star-girl --sheet=path/to/front.png --label="Star Girl"   # --box=x,y,w,h to set the crop yourself
```

---

## 2. A tour of the lab

### The lab: the sheet next to the code

Pick a character and a **part** (the whole figure, parts, expressions, poses), then a **variant**, which is one crop of
a reference sheet. The painting is on the left, and the live WebGL drawing is on the right.

![Poses in the lab: the waving pose, painted and drawn](docs/images/lab-poses.png)

### Compare modes

Five ways to see the gap: **side by side**, **onion** (overlaid), **difference**, **wipe** and **blink**. The same view is
available from the command line: painting | code | difference.

![Painting, code drawing and their difference for the front figure](docs/images/compare-front.png)

The difference panel shows where the drawing is off: white is a match, colour is a miss.

![The happy expression: painting, code, difference](docs/images/compare-happy.png)

### Scores

Every variant gets a **fidelity** score (0–100) made of silhouette overlap, colour distance (ΔE), palette, structure
(SSIM), contrast, edges and texture. Save a baseline, change the code, and compare the two.

![The score page: every variant and its metrics](docs/images/scores.png)

### Faces, rigs and clips

A character can expose **face params** (eyes, lids, gaze, brows, mouth, blush), shown as buttons and sliders in the
lab, plus a **rig** of parts that **clips** move over time. `anim.html` and `npm run lab -- film` lay a clip out as a
filmstrip.

![The wave clip as a filmstrip](docs/images/clip-wave.png)

---

## 3. Meet Captain Kite

![Captain Kite's six reference sheets](docs/images/reference-sheets.png)

**Milo Reyes** is a shy bike courier. When someone needs help, he becomes **Captain Kite**, a hero who rides the wind.
He's drawn in a flat anime cel style with the engine's **cel material**: a flat colour, one hard shadow, a rim light and an
even outline.

| Part | Variants |
|------|----------|
| Whole | front, Milo in street clothes, turnaround (front, three-quarter, side, back) |
| Parts | head, mask and eyes, torso and emblem, belt, cape, both arms, legs |
| Expressions | neutral, happy, surprised, determined, sad, laughing |
| Poses | walking, waving, sitting, looking up, hero landing, flying |

That's 26 variants with a mean score of about 83, plus face presets, an outfit switch (`outfit: "civilian"`), a rig,
and two clips (`kite-wave`, `kite-blink`).

![The hero landing pose: painting, code, difference](docs/images/compare-landing.png)

How he's built (`packs/captain-kite/`):
- `kite-shapes.js` holds his flat colour regions as outlines, with their colours and shadow settings. It's generated
  from the sheets by `tools/trace-sheets.py` (Python, numpy, scipy, Pillow), so you can remake it.
- `kite-face.js` draws the eyes, brows, nose and mouth in code, so the face can change expression.
- `captain-kite.js` holds the variants, the face presets, the rig and the clips, and registers the character.

The sheets were generated for this project with OpenAI image generation through the Codex CLI. The whole pack, code and
sheets, is CC0.

---

## 4. Guide: make your own character

This walks through `examples/blob/`, the smallest character that works: one sheet, one variant and a blink.

![Blob: the sheet, the code drawing, the difference](docs/images/guide-blob.png)

### Step 1: Make a reference sheet

Paint, draw or generate a picture of your character on a plain background and save it as a PNG. The box
(`x, y, width, height` in pixels) around the figure is the crop the lab scores; the New character page and
`npm run new-pack` find it for you, and you can set it by hand.

```
examples/blob/
  pack.json
  blob.js
  sheets/front.png      512 × 512, the figure inside [96, 96, 320, 320]
```

### Step 2: Describe the pack

`pack.json` names the pack, its license, the scripts to load (in order) and where its sheets are served from:

```json
{ "id": "blob", "label": "Blob", "version": "0.1.0", "engine": ">=0.1.0", "license": "CC0-1.0",
  "scripts": ["blob.js"], "sheetsBase": "/packs/blob/sheets/" }
```

### Step 3: Draw it in code

A `build(params)` function returns **draw ops**: shapes (lists of points) with a material. Work in the sheet's pixels,
measuring positions on the sheet.

```js
const CL = window.CharacterLab;
const { ellipse } = CL.lab.geom;                       // shared helpers: ellipse, spline, rng, flat
const INK = "#281e28";
const cel = (base, shade) => ({ type: 8, ramp: [shade, shade, base, base], line: INK, lineW: 3, shadow: 14, clean: true });

function build(p = {}) {
  const blink = p.eyes === "closed" ? 0.1 : 1;         // a face param from the lab
  return {
    world: [512, 512],
    ops: [
      { kind: "fill", pts: [[0, 0], [512, 0], [512, 512], [0, 512]],          // the backdrop
        mat: { type: 8, ramp: Array(4).fill("#eef0f3"), lineW: 0, shadow: 0, clean: true }, seed: 1 },
      { kind: "fill", pts: ellipse(256, 256, 120, 120), mat: cel("#ff8a1f", "#d0661a"), seed: 2 },   // body
      { kind: "fill", pts: ellipse(221, 240, 15, 20 * blink), mat: cel(INK, INK), seed: 3 },        // eyes
      { kind: "fill", pts: ellipse(291, 240, 15, 20 * blink), mat: cel(INK, INK), seed: 4 },
    ],
  };
}
```

### Step 4: Register the character

The pack's last script registers the sheets and the parts. A **variant** is a crop of a sheet (`frame`) plus the
`build` that draws it; `fit` maps sheet pixels onto the crop.

```js
CL.lab.registerCharacter({
  id: "blob", label: "Blob",
  sheetsBase: "/packs/blob/sheets/",
  sheets: { "blob-front": { file: "front.png", name: "blob front sheet" } },
  parts: [{
    id: "blob", label: "Whole", whole: true,
    variants: [{ id: "blob-front", label: "Front", sheet: "blob-front", kind: "mapped",
      frame: [96, 96, 320, 320], scale: 1, fit: { s: 1, tx: -96, ty: -96 }, build }],
  }],
});
```

### Step 5: Load it and score it

Point the lab at the folder that holds your pack:

```bash
LAB_PACKS=examples npm start                         # Blob appears in the lab
LAB_PACKS=examples npm run lab -- score --part=blob  # blob-front  90.3
LAB_PACKS=examples npm run lab -- sheet --v=blob-front --out=out/blob.png   # painting | code | difference
```

### Step 6: Improve, measure, repeat

1. Save a baseline: `npm run lab -- score --save=out/base.json`.
2. Change the drawing: a shape, a colour, the shadow.
3. Run `npm run lab -- score --compare=out/base.json` to see each variant's change, and `sheet --v=...` to see where.

When the whole figure reads well, add more: more variants (turnaround, expressions, poses) as crops of more sheets, an
`expressions` block for the lab's face buttons, and a `rig` and `clips` for animation. Captain Kite's pack shows
each of these. `packs/README.md` documents every field of `pack.json` and `registerCharacter`, and `checkPack` tests a
pack against those rules (call it from your pack's `tests/`).

---

## 5. Keep your characters in their own repository

Your characters don't have to live in this repository. Put them in any folder, a private repository for example, and
list it in `lab.config.json` (git-ignored):

```bash
cp lab.config.example.json lab.config.json
```

```json
{
  "packs": ["../my-character-packs"],
  "mounts": { "/sheets/": "../my-reference-sheets/" }
}
```

- `packs`: folders of packs, relative to the lab. `LAB_PACKS` (colon-separated) adds more.
- `mounts`: other folders served read-only on the same port, if a pack's sheets live elsewhere.
- `newPacksDir`: where the New character page makes packs (default: the lab's own `packs/`; `LAB_NEW_PACKS` too).

The server lists every pack at `/packs.json`, serves each one read-only at `/packs/<id>/` (its `tests/` and `tools/`
stay private), and the pages load them in their `order`. Its one write is `POST /api/characters`, which the New
character page uses to make a pack; it answers only the lab's own page. With no packs at all, the lab opens with a short message
saying so.

---

## 6. Give a character its own look

![The cel material: one shape lit from three directions](docs/images/cel-material.png)

The renderer (`lab/js/wc-gl.js`) draws layers of ops, each an SDF shape with a material. The built-in materials
are:
- **painted** (the default): a soft wash with weak light, pigment blooms and paper grain;
- **pools**: soft-edged colour;
- **cel**: shown above;
- eyes, blush, halos and strokes.

A pack can add its own **materials and draw modes as GLSL**. A script named `*-gl.js` calls
`CharacterLab.wcGL.registerMaterial()` or `registerMode()`, and the engine splices those chunks into its shader before it
compiles. The loader runs every pack's `*-gl.js` first. A pack can also hold materials only (`"kind": "materials"`):
other packs then `"requires"` it to share one look. The API is documented at the top of `wc-gl.js`, and
`lab/cel.html` shows the cel material on its own.

---

## 7. Command line reference

| Command | What it does |
|---------|--------------|
| `npm run lab -- score` | every variant's score (`--part=`, `--v=`, `--save=`, `--compare=`, `--json`) |
| `npm run lab -- sheet --v=<id>` | painting \| code \| difference image for one variant |
| `npm run lab -- shot --url=<page>` | screenshot of a lab page once it's ready (`--url=/` the home page, `--full`) |
| `npm run lab -- film --clip=<id>` | a clip's frames as a filmstrip (`--frames`, `--zoom`, `--fps`) |
| `npm run lab -- board` / `check` / `packages` | group scores by family, guard a change, split work into packages |

The header of `lab/scripts/wc-lab.mjs` lists every option. Output goes to `out/` (git-ignored).

---

## 8. Folder map

```
index.html            home page: create a character, try the sample, every character found
server.mjs            local server (loopback only, browser assets only; its one write is lab-api.mjs)
lab-api.mjs           POST /api/characters: the New character page makes a pack
lab-config.mjs        finds packs and mounts (lab.config.json, LAB_PACKS)
lab/                  the engine
  index.html          the lab               score.html   scores      anim.html   clips
  new.html            a new character       cel.html     the cel material
  inspect.html, bake.html                   tools for figures scored with landmarks
  js/                 renderer, catalog, scoring, rig and clips, face params, pack API and loader
  scripts/            command line, pack maker (pack-maker.mjs, png.mjs), test runner
packs/                the lab's own packs: captain-kite/ and the pack format (README.md)
examples/blob/        the guide's tutorial character
docs/images/          the pictures in this README
docs/brand/           the logo (SVG, light and dark wordmarks, a 512 px PNG)
tests/                server, config, pack API, loader and renderer tests
```

---

## 9. FAQ

**What is Character Lab?**
An open-source (MIT) local lab for drawing 2D characters in code with WebGL2 and measuring how close each drawing is to
its reference picture. It shows the painting and the code drawing side by side, scores every part, and comes with a
pack format, a command line, Agent Skills and an MCP server so AI agents can do the drawing.

**How is the score computed?**
For each variant, the code drawing and the crop of the reference sheet are compared pixel by pixel in the browser
(`lab/js/wc-compare.js`). The fidelity score (0–100) is a weighted sum: 30% landmarks (by default, and for every pack in
this repo, the silhouette overlap again), 25% silhouette overlap (IoU of the inked pixels), 15% palette (from the CIE76 colour distance,
ΔE, on a coarse grid), 10% feature shapes (overlap of the dark, pink and saturated areas), 10% structure (SSIM of the
brightness) and 10% texture (local contrast and edges, region by region). Scores can differ a little between machines
and WebGL renderers, so compare a change against a baseline taken on the same machine.

**Does it need a GPU or an API key?**
No API key: the lab itself calls no AI service, and its server listens only on your computer (`127.0.0.1`). The pages
load their web fonts from Google Fonts. The command line drives headless Chrome with WebGL: Metal on macOS, SwiftShader
software rendering on Linux, so a GPU isn't required there. Your agent may use its own tools (for example image
generation) when you ask it to make a reference picture.

**What license is it under?**
The code is MIT. The Captain Kite pack and the Blob example, code and sheets, are CC0.

---

## 10. License

The code is **MIT** (`LICENSE`). The Captain Kite pack and the Blob example, code and sheets, are **CC0**
(`packs/captain-kite/LICENSE`, `examples/blob/LICENSE`). See `CONTRIBUTING.md` to help out.

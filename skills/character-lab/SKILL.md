---
name: character-lab
description: Start here for anything about Character Lab, the tool that draws characters in code (WebGL2) and scores each drawing against its reference picture. Covers what it is, installing and starting it on the user's computer, giving the user the link, and which Character Lab skill to use next. Use when the user mentions Character Lab, wants to try it, see it, install it, or asks what it can do.
---

# Character Lab

Character Lab draws a character entirely in code (shapes, a cel material and a rig, rendered with WebGL2; no images at
render time) and scores every drawing against a reference picture, part by part, from 0 to 100. A character is a
**pack**: a folder with `pack.json`, its scripts and its pictures. The lab ships with one example, Captain Kite.

Talk to the user in plain words. Run every command yourself; never ask the user to run `npm` or open a terminal. The
user only needs a browser link.

## Get it running

**With the Character Lab tools (MCP server `character-lab`)**: call `lab_start`. It installs what it needs the first
time, starts the lab in the background and returns the link. `lab_status` tells you the lab's folder (`labDir`) and
where new characters go.

**Without the tools**, in a folder the user is happy to use:

1. Check the requirements: `node --version` (22.12 or newer) and Google Chrome or Chromium (needed for scoring; set
   `CHROME=/path/to/chrome` if it is somewhere unusual). If one is missing, tell the user what to install; don't
   install system software yourself.
2. `git clone https://github.com/CharacterLab/CharacterLab.git` and `cd CharacterLab`.
3. `npm ci`, then `npm test` (it must pass).
4. Start it in the background: `npm start` (keep it running), and wait until `http://localhost:8765/` answers.
5. Give the user **http://localhost:8765/lab/** (one character: `http://localhost:8765/lab/?char=<id>`).

To check scores yourself: `npm run lab -- score` (Captain Kite's mean is about 82.7).

## Which skill next

| The user wants to | Skill |
|-------------------|-------|
| add their own character, from a picture or a description | `create-character` |
| make a character's drawing closer to its picture | `draw-character` |
| give it expressions, make it move (wave, blink, nod), see a filmstrip | `animate-character` |
| know where a pack's files go, keep characters private, edit `pack.json` | `pack-format` |

## What to tell the user when you finish

The link, what you made (in a sentence), the score (and the change if you improved it), and one suggestion for what to
try next. Keep file paths and commands out unless they ask.

## Rules

- **Draw, don't copy.** Never put the reference picture, or pixels or textures taken from it, into the drawing to raise
  a score. Measuring positions, outlines and flat colours on the picture is how you draw; copying it is not.
- **The engine stays generic.** Everything about a character goes in its pack, never in `lab/`.
- **Only add pictures the user has the rights to**, and keep private characters outside the repository (`pack-format`).
- **Never commit** `out/`, `node_modules/` or `lab.config.json`.

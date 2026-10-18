# Instructions for AI agents

This file is for AI agents (Claude Code, Codex, Cursor, …) working with Character Lab. `CLAUDE.md` points here.
People can read `README.md` instead.

Character Lab draws characters in code (WebGL2) and scores each drawing against its reference picture. A character is
a **pack**: a folder with `pack.json`, its scripts and its pictures. The engine is `lab/` and never names a character.
The product is called **the lab**.

The user should never have to type a command: you run them, and you give the user a link to look at. Talk to them in
plain words.

## Skills: read the one that fits

The how-to lives in [Agent Skills](https://agentskills.io) under `skills/`. As a plugin (Claude Code, Codex) they load
by themselves; otherwise open the `SKILL.md` that fits the request and follow it.

| The user wants to | Read |
|-------------------|------|
| try the lab, install it, see it, know what it does | [`skills/character-lab/SKILL.md`](skills/character-lab/SKILL.md) |
| add a character from a picture or a description | [`skills/create-character/SKILL.md`](skills/create-character/SKILL.md) |
| make a drawing match its picture better | [`skills/draw-character/SKILL.md`](skills/draw-character/SKILL.md) |
| expressions, a rig, animation clips, filmstrips | [`skills/animate-character/SKILL.md`](skills/animate-character/SKILL.md) |
| pack files, `pack.json`, private characters | [`skills/pack-format/SKILL.md`](skills/pack-format/SKILL.md) |

If the user pasted a prompt from the README, it already says what they want: do it, then reply with what you made, the
score and the link.

## Tools (MCP)

`mcp/server.mjs` is an MCP server (stdio, no dependencies) with `lab_start`, `lab_status`, `list_characters`,
`create_character`, `score`, `compare` and `film`. The plugins start it for you; any other MCP client can run
`node mcp/server.mjs`. Everything it does is also a command in the lab's folder, below.

## Install and check

Requires Node.js 22.12+ and Google Chrome or Chromium (for scoring; `CHROME=/path/to/chrome` if it is elsewhere). Check
both; if one is missing, tell the user what to install rather than installing system software yourself.

```bash
npm ci
npm test                    # must pass before and after your change
npm run characterlab -- score        # every variant's score; Captain Kite's mean is 81.4 (SwiftShader, Chrome 155)
npm start                   # in the background; give the user http://localhost:8765/lab/
```

Other commands: `npm run new-pack` (start a character), `npm run characterlab -- sheet --v=<variant>` (painting | code |
difference), `npm run characterlab -- film --clip=<id>` (filmstrip). The header of `lab/scripts/wc-lab.mjs` lists every option.

## Rules

- **Draw, don't copy.** Never draw the reference picture itself, or pixels or textures sampled from it, to raise a
  score. Measuring positions, outlines and flat colours on it is fine.
- **The engine stays generic.** No character-specific code, names or colours in `lab/`. A look a pack needs that the
  engine lacks is a renderer extension (`*-gl.js`), not an engine edit.
- **Keep ids prefixed.** Variant ids and sheet keys start with the pack id (`star-girl-front`).
- **Pass the checks.** `npm test` passes, and other characters' scores don't drop (compare with a baseline saved
  before your change: `npm run characterlab -- score --save=out/base.json`, then `--compare=out/base.json`).
- **Mind the license.** A pack carries its own `license`. Only add pictures the user has the rights to; keep private
  characters outside this repository (`lab.config.json` or `LAB_PACKS`).
- **Never commit** `out/`, `node_modules/` or `lab.config.json`.

## Where things are

| Path | What |
|------|------|
| `lab/` | the engine: pages, `js/` (renderer `wc-gl.js`, pack API `lab-packs.js`, loader), `scripts/` (CLI `wc-lab.mjs`, pack maker) |
| `packs/` | packs that ship with the lab; `packs/README.md` is the pack format |
| `packs/captain-kite/` | the full example: several sheets, parts, expressions, poses, rig, clips |
| `examples/blob/` | the smallest working pack |
| `skills/` | the Agent Skills |
| `mcp/` | the MCP server (`server.mjs`; tools in `tools.mjs`, the lab's server and CLI in `lab.mjs`) |
| `plugin.json`, `.claude-plugin/`, `.codex-plugin/`, `.agents/plugins/`, `.mcp.json`, `mcp.json` | the plugin manifests |
| `server.mjs`, `lab-config.mjs` | local server and pack discovery (`packs/`, `lab.config.json`, `LAB_PACKS`) |
| `tests/` | engine, server, MCP and manifest tests; each pack has its own `tests/` |

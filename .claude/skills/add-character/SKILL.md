---
name: add-character
description: Add a new character to Character Lab — scaffold a pack from a reference picture, draw it in code with the cel material, and score it against the picture. Use when the user wants to add, create, draw or import a character, or asks how to start their own character.
---

# Add a character to Character Lab

Follow "Add a character" in `AGENTS.md` at the repository root. In short:

1. **Reference sheet:** a PNG of the character on a plain background, front view, full body.
2. **Scaffold:** `npm run new-pack -- <id> --sheet=<png> --label="Name"` (it finds the figure's box; `--box=x,y,w,h`
   overrides it), then `npm test`.
3. **Draw:** in `packs/<id>/<id>.js`, replace the placeholder with shapes measured on the sheet (cel material,
   `CharacterLab.lab.geom.ellipse` / `spline`), back to front.
4. **Measure:** `npm run lab -- score --part=<id>` and `npm run lab -- sheet --v=<id>-front --out=out/<id>.png`. Look
   at the difference image, fix the biggest misses, and repeat.
5. **Show the user:** run `npm start` in the background and send them `http://localhost:8765/lab/?char=<id>`.

Never draw the reference image itself to raise the score. Keep everything about the character inside its pack.

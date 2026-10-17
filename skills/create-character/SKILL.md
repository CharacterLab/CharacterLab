---
name: create-character
description: Add a new character to Character Lab from the user's picture(s), or from a description by first generating a reference picture. Makes the character pack, opens it in the lab, and reports its first score. Use when the user wants to add, create, import or start a character, or gives a picture of a character.
---

# Create a character

The lab must be running first (skill `character-lab`). Talk to the user in plain words and run everything yourself.

## 1. Get a reference picture

What works best: a PNG, the character **full body, front view, nothing cropped**, on a **plain flat background**,
ideally square (1024×1024). Flat colours with one hard shadow and clean outlines match the lab's cel material best.
More pictures (side view, expressions, poses) can be added as extra sheets.

- **The user gave a picture:** use it. If it is a JPEG or WebP, convert it to PNG (`sips -s format png in.jpg --out
  front.png` on macOS, or any image tool you have). Look at it: if the background is busy or the figure is cut off, tell
  the user and ask for a better one, or offer to generate one.
- **The user only described the character:** if you have an image-generation tool, make the picture with a prompt like
  *"<description>. Full body, front view, standing, flat cel-shaded anime style, clean dark outlines, one hard shadow,
  plain light grey background, centred, nothing cropped, 1024x1024."* Show it to the user and ask if it's right before
  going on. Without an image tool, ask the user for a picture.

## 2. Make the pack

**With the Character Lab tools:** call `create_character` with `name` (the display name) and `images` (PNG paths, the
front view first). Leave `box` out: the lab finds the figure on the picture. Pass `dir` only when the user wants the
character kept private, outside the lab (see `pack-format`). It returns the `id`, the pack's folder, the link and the
first score.

**Without the tools** (in the lab's folder):

```bash
npm run new-pack -- <id> --sheet=<front.png> --label="<Name>"     # --box=x,y,w,h if the figure isn't found well
npm test
npm run lab -- score --part=<id>
```

`<id>` is lowercase letters, digits and dashes (`star-girl`). The pack is `packs/<id>/` (or `--dir=<folder>`).
People who prefer clicking can also upload pictures at `http://localhost:8765/lab/new.html`.

## 3. Show the user

Give them the link (`http://localhost:8765/lab/?char=<id>`) and say plainly: the character is in the lab, its picture on
the left, the code drawing on the right; the first drawing is a placeholder shape, scored about 40–55. Offer to draw it
properly: that is the `draw-character` skill, and it is what makes the score climb (about 80 or more is a good whole
figure).

If the user asked for the whole thing in one go ("add my character and draw it"), go straight on to `draw-character`
and report at the end.

## If something fails

- *Chrome not found:* scores need Google Chrome or Chromium. Tell the user what to install, or set `CHROME`.
- *Id already exists:* pick another id, or ask whether to replace the old character.
- *The figure box looks wrong* (the placeholder sits off the figure): pass `box` as `[x, y, width, height]`,
  measured on the picture with a few pixels of margin.

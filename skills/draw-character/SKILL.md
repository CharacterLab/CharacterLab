---
name: draw-character
description: Improve a Character Lab character's drawing in code so it matches its reference picture, measuring shapes and colours on the picture, drawing them with the cel material, and checking each change with the score and the painting | code | difference image. Use when the user wants a character drawn, drawn better, closer to its picture, or a higher score.
---

# Draw a character in code

The drawing is the `build(p)` function in the pack's main script (`<pack>/<id>.js`). It returns
`{ world: [w, h], ops: [...] }`: shapes in the picture's own pixels, drawn back to front. Read
[references/ops.md](references/ops.md) for the shapes, materials and helpers.

## The loop

1. **Baseline.** Score it (`score` tool with the character, or `npm run lab -- score --part=<id> --save=out/<id>-base.json`)
   and look at it (`compare` tool with the variant, or `npm run lab -- sheet --v=<variant>`). The picture is
   painting | code | difference: white where they match, colour where the drawing misses.
2. **Measure on the picture**, never guess. Open the sheet and read coordinates off it; sample colours from flat areas
   (a small script that prints pixel colours, or crop and look). Note the outline colour and width and the shadow side.
3. **Change one thing**: the biggest coloured area in the difference first. Order of work: silhouette, big colour
   regions (body, clothes, hair), limbs, head, then face details.
4. **Check**: score again (`--compare=out/<id>-base.json` shows the change per variant) and look at the new difference.
   Keep a change only if it helped; otherwise undo it.
5. Repeat. Every few rounds run `npm test` (the pack's own test must pass) and, if the lab has other characters,
   check their scores did not move.

## How to draw well here

- **Shapes:** `spline(points, true)` through points measured along an outline gives smooth, organic shapes; use
  `ellipse(cx, cy, rx, ry, rot)` for eyes, buttons and round parts. A dozen measured points beats a perfect formula.
- **Material:** the cel material for every region: base colour, its shadow colour (sampled from the shaded side),
  outline colour and width as painted. Keep the backdrop the picture's own background colour.
- **Layers:** backdrop, back hair/cape, legs, body, arms, head, front hair, then eyes, brows, nose and mouth last.
- **Face:** draw the face from params (`p.eyes`, `p.mouth`, …) from the start, so expressions work later
  (`animate-character`).
- **Seeds:** give every op its own `seed` number.

## When to stop

Stop and report when the user is happy, or when three rounds in a row gain less than half a point. About 80 or more
is a good whole figure (Captain Kite's front is 88). Never stop at a number the user didn't ask for if the drawing
still visibly misses something big; never chase points with tricks that make it look worse.

## Never

- Never draw the reference picture itself, or pixels, textures or traced bitmaps sampled from it, to raise the score.
  The score must measure code against the painting.
- Never edit the engine (`lab/`) for one character; a look the engine lacks is a renderer extension (`pack-format`).
- Never lower another character's score.

Tell the user the score before and after, and give the link so they can see it in the lab.

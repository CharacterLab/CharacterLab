---
name: animate-character
description: Give a Character Lab character expressions (face params, preset buttons, sliders) and animation (a rig of parts and clips such as a wave, a blink or a nod), and check them as filmstrips. Use when the user wants their character to smile, blink, wave, move, change expression, or wants an animation or filmstrip.
---

# Expressions and animation

All of it lives in the character's pack and is registered with `registerCharacter` (skill `pack-format`). Captain
Kite's pack (`packs/captain-kite/captain-kite.js`) has a working example of each piece; read it first.

## 1. Face params: the drawing reacts to `p`

`build(p)` reads params and draws accordingly. Use the lab's common names so the lab's buttons, sliders and the idle
blink work:

| param | values |
|-------|--------|
| `eyes` | `"open"`, `"closed"`, `"happy"`, `"wide"` (and `eyeL` / `eyeR` for one eye, e.g. `"wink"`) |
| `lid` | 0 (open) … 1 (closed): the idle blink uses it |
| `look`, `lookY` | −1 … 1: where the eyes look |
| `brows` | your own names: `"neutral"`, `"raised"`, `"sad"`, … |
| `mouth` | your own names: `"smile"`, `"open"`, `"frown"`, … |
| `smile`, `mouthOpen`, `blush` | numbers for sliders |

Draw each mouth and brow shape from measurements of the expressions picture if there is one; add an expressions sheet
and one variant per expression so each is scored (`draw-character`).

## 2. The `expressions` block: buttons and sliders in the lab

```js
expressions: {
  presets: { happy: { label: "Happy", p: { mouth: "open", eyes: "happy", brows: "raised" } }, /* … */ },
  mouths: { smile: "Smile", open: "Open", frown: "Frown" },
  sliders: [["smile", "Smile", -1, 1.5], ["mouthOpen", "Mouth open", 0, 1]],
  rest: { smile: 0, mouthOpen: 0, blush: 0 },          // the values a clip returns to
  build: (p) => build(p),                               // the figure the expression buttons show
}
```

## 3. The rig: parts that move

Tag every op with the part it belongs to (`part: "head"`), and return the rig with the scene:

```js
return { ops, world, rig: { def: {
  body: { pivot: [512, 980] },                              // turns about the feet
  head: { parent: "body", pivot: [512, 420] },              // turns about the neck
  hand: { parent: "body", pivot: [700, 520] },              // about the wrist
}, pose: p.pose || {} } };
```

and list the parts clips may move: `rig: { parts: ["body", "head", "hand"] }` in `registerCharacter`. Measure pivots on
the picture (neck, shoulder, wrist, feet).

## 4. Clips

```js
clips: [
  { id: "<id>-blink", label: "Blink", group: "eyes", dur: 1.2,
    p: { lid: [[0, 0], [0.1, 1, "in"], [0.24, 0, "out"]] } },
  { id: "<id>-wave", label: "Wave", group: "head", dur: 1.2, loop: true, p: { mouth: "smile" },
    pose: { hand: { rot: [[0, -8, "sine"], [0.3, 12, "sine"], [0.6, -8, "sine"], [0.9, 12, "sine"], [1.2, -8, "sine"]] } } },
]
```

A track is `[[time, value, ease?], …]` in seconds; pose channels are `rot` (degrees), `dx`, `dy`, `sx`, `sy`. Groups:
`idle`, `eyes`, `mouth`, `head`, `ears`, `body`, `mood`. The full format is at the top of `lab/js/wc-anim.js`.

## 5. Check it

- `film` tool with the clip id (or `npm run characterlab -- film --clip=<clip-id> --frames=8`): the frames side by side. Look
  at it: parts must stay attached, nothing should jump between frames.
- `npm test` must pass, and the still variants' scores must not drop (a pose of zero must draw exactly as before).
- Give the user the link: the clip plays in the lab's Animations panel.

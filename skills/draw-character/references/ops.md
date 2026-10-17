# Draw ops, materials and helpers

The full reference is the comment at the top of `lab/js/wc-gl.js` (the renderer) and `lab/js/lab-geom.js` (the helpers).
This is the part you need for a cel-style character.

## A builder

```js
const CL = window.CharacterLab;
const { ellipse, spline } = CL.lab.geom;
const INK = "#281e28";                                   // the outline colour, sampled from the picture
const cel = (base, shade, extra = {}) => ({ type: 8, ramp: [shade, shade, base, base], line: INK, lineW: 3, shadow: 12, clean: true, ...extra });

function build(p = {}) {
  const eyesClosed = p.eyes === "closed";
  return {
    world: [1024, 1024],                                 // the picture's size in pixels
    ops: [
      { kind: "fill", pts: [[0, 0], [1024, 0], [1024, 1024], [0, 1024]], mat: cel("#eef0f3", "#eef0f3", { lineW: 0, shadow: 0 }), seed: 1 },
      { kind: "fill", pts: spline([[420, 380], [600, 380], [640, 700], [384, 700]], true), mat: cel("#3d6fd6", "#2b4fa0"), seed: 2, part: "body" },
      { kind: "fill", pts: ellipse(512, 300, 110, 120), mat: cel("#f6c9a8", "#d99c7c"), seed: 3, part: "head" },
      { kind: "fill", pts: ellipse(470, 300, 12, eyesClosed ? 2 : 16), mat: cel(INK, INK, { lineW: 0 }), seed: 4, part: "eyes" },
    ],
  };
}
```

## Ops (`op.kind`)

| kind | what | key fields |
|------|------|------------|
| `fill` | a closed shape with a material | `pts`, `mat`, `seed`, optional `part` (rig) |
| `shadow` | a multiplied shadow shape | `pts`, `mat` |
| `outline`, `stroke` | lines (brows, mouth lines, folds) | `pts`, `mat` (`line`, `lineW`) |
| `blush` | multiplied soft colour on cheeks | `pts`, `tint`, `amt` |
| `halo` | a soft pool of colour laid over | `pts`, `tint`, `amt`, `mat.soft` |
| `eye` | a full painted eye (iris, pupil, lids, glints) | `c`, `r`, `iris`, `irisR`, `pupilR`, `lid`, … |
| `clip` | clips what follows to a shape | `pts` |

## The cel material (`mat.type: 8`)

- `ramp: [shadow, shadow, base, rim]`: the flat base colour is `ramp[2]`, the hard shadow `ramp[0]`, an optional rim
  light `ramp[3]` (with `mat.rim` > 0).
- `light`: where the light comes from, in radians (default upper left, `-3π/4`); `shadow`: how far the shadow reaches
  in (pixels); `line`, `lineW`: the outline; `clean: true`: crisp edges.

## Helpers (`CharacterLab.lab.geom`)

- `ellipse(cx, cy, rx, ry, rot = 0, n = 48)`
- `spline(points, closed = true, per = 8)`: a smooth curve through measured points
- `rng(seed)`: a deterministic random generator
- `flat(ramp, extra)`: the painted (watercolour-like) material, if the picture is painted rather than cel

## Measuring on the picture

The lab gives no "trace" button on purpose: measure. A few ways that work:

- Crop the region and look at it closely; read the pixel coordinates of the outline's turning points.
- A short script (Node with any PNG reader, or Python with Pillow) that prints the colour at given points, or the
  bounding box of all pixels close to a colour.
- `npm run characterlab -- sheet --v=<variant> --h=720` for a bigger painting | code | difference image.

Taking coordinates and flat colours from the picture is fine. Putting the picture's pixels into the drawing is not.

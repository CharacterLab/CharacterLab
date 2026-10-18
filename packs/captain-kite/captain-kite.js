// Captain Kite (Milo Reyes), the Character Lab's open-source example character: a friendly young hero who rides the
// wind, in a flat anime cel style. Drawn in code with the engine's cel material (wc-gl.js mat.type 8: one flat colour,
// one hard shadow tone cut along the shape's own outline, an even dark outline; mat.clean: no paper grain) and
// scored against his reference sheets (sheets/, CC0).
//
// How he is built:
//   - kite-shapes.js: every figure on the sheets as flat cel regions (suit, cape, gloves, boots, belt, emblem, skin,
//     hair, mask…), their outlines traced from the sheet and simplified, their two tones, the reach and angle of each
//     region's cel shadow, and the face's measurements (tools/trace-sheets.py makes it). The regions are the drawing;
//     the shading and the line are the cel material's, computed from each outline.
//   - kite-face.js: the face (eyes, brows, nose, mouth, blush, glasses) drawn by code where it was measured, moved by
//     the face params (its header lists them).
//   - this file: a figure's scene (the backdrop, its regions in order, the face, the rig), the catalog (variants are
//     crops of the sheets: frame, scale and fit), the face's presets, the rig and two clips, and the registration.
// World units are sheet pixels: every figure is drawn in its sheet's own coordinates.
(function () {
  const CharacterLab = (window.CharacterLab = window.CharacterLab || {});
  const NS = (CharacterLab.captainKite = CharacterLab.captainKite || {});
  const ID = "captain-kite";
  const SHAPES = () => CharacterLab.kiteShapes || {};
  const num = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);

  const SHEETS = {
    "kite-identity": { file: "01-identity.png", name: "Captain Kite identity sheet" },
    "kite-turn": { file: "02-turnaround.png", name: "Captain Kite turnaround sheet" },
    "kite-expr": { file: "03-expressions.png", name: "Captain Kite expressions sheet" },
    "kite-poses": { file: "04-poses.png", name: "Captain Kite poses sheet" },
    "kite-civilian": { file: "05-civilian.png", name: "Milo Reyes civilian sheet" },
    "kite-action": { file: "06-hero-poses.png", name: "Captain Kite action poses sheet" },
  };
  const SHEET_OF = { "01-identity.png": "kite-identity", "02-turnaround.png": "kite-turn", "03-expressions.png": "kite-expr",
    "04-poses.png": "kite-poses", "05-civilian.png": "kite-civilian", "06-hero-poses.png": "kite-action" };

  // ---------- a figure's scene ----------
  const LINE = 1.0;   // the outline's width, × the line measured on the sheet
  const cel = (base, shade, o) => Object.assign({ type: 8, ramp: [shade, shade, base, base], clean: true, rim: 0 }, o);
  const ptsOf = (flat) => { const out = []; for (let i = 0; i + 1 < flat.length; i += 2) out.push([flat[i], flat[i + 1]]); return out; };
  // The traced outline's corners cut a little (Chaikin, at most CUT px from each corner): pixel-traced polygons read as
  // drawn curves, while long straight edges and real points (the emblem, the cape's tip) keep their shape.
  const CUT = 1.6;
  function soften(P) {
    const out = [], n = P.length;
    for (let i = 0; i < n; i++) {
      const a = P[i], b = P[(i + 1) % n], d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, k = Math.min(0.25, CUT / d);
      out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k], [b[0] - (b[0] - a[0]) * k, b[1] - (b[1] - a[1]) * k]);
    }
    return out;
  }
  // an outline as wide as the sheet inks that region's edge (none where its edge is its own colour against another)
  const inkW = (ink) => Math.min(1, ink / 0.4);
  const bboxOf = (P) => P.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [1e9, 1e9, -1e9, -1e9]);
  const inBox = (P, b) => { const [x0, y0, x1, y1] = bboxOf(P), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2; return cx >= b[0] && cx <= b[2] && cy >= b[1] && cy <= b[3]; };

  // The figure's regions as they are on the sheet (cached: they never change), with what the face needs to know.
  const cache = {};
  function regions(fid) {
    if (cache[fid]) return cache[fid];
    const f = SHAPES()[fid];
    if (!f) throw new Error(`${ID}: no traced figure "${fid}" (kite-shapes.js)`);
    const lw = f.lineW * LINE, list = f.shapes.map(([g, part, base, shade, reach, light, ink, flat], i) => {
      const pts = soften(ptsOf(flat));
      return { g, part, base, shade, pts, op: { kind: "fill", pts, seed: 200 + i, part,
        mat: g === "hole" ? cel(f.bg, f.bg, { line: f.line, lineW: lw, shadow: 0 }) : cel(base, shade, { line: f.line, lineW: lw * inkW(ink), shadow: reach, light }) } };
    });
    const head = (g) => list.find((s) => s.g === g && s.part === "head");
    const mask = f.faceBox ? list.find((s) => s.g === "orange" && s.part === "head" && inBox(s.pts, f.face ? faceBox(f) : f.box)) : null;
    // the drawing's lines inside a region (folds, muscles, the hoodie's pocket): thin bands of the line's colour
    const inner = (f.lines || []).map(([part, w, flat], i) => ({ kind: "fill", pts: NS.geom.band(ptsOf(flat), (w * LINE) / 2, 0.45), seed: 900 + i, part,
      mat: cel(f.line, f.line, { lineW: 0, shadow: 0 }) }));
    if (mask) mask.op.mat = Object.assign({}, mask.op.mat, { lineW: 0 });   // the mask has no ink line on the sheet
    const skin = head("skin") || list.find((s) => s.g === "skin");
    const hair = head("dark") || list.find((s) => s.g === "dark");
    // rig pivots: the head turns about its neck, a raised hand about its wrist, the body about its feet
    const hb = list.filter((s) => s.part === "head").reduce((b, s) => { const q = bboxOf(s.pts); return [Math.min(b[0], q[0]), Math.min(b[1], q[1]), Math.max(b[2], q[2]), Math.max(b[3], q[3])]; }, [1e9, 1e9, -1e9, -1e9]);
    const hand = list.filter((s) => s.part === "hand").map((s) => bboxOf(s.pts));
    const handB = hand.length ? hand.reduce((b, q) => [Math.min(b[0], q[0]), Math.min(b[1], q[1]), Math.max(b[2], q[2]), Math.max(b[3], q[3])]) : null;
    const [x0, y0, x1, y1] = f.box;
    const def = {
      body: { pivot: [(x0 + x1) / 2, y1] },
      head: { parent: "body", pivot: hb[0] < 1e8 ? [(hb[0] + hb[2]) / 2, hb[3]] : [(x0 + x1) / 2, y0] },
      face: { parent: "head", pivot: hb[0] < 1e8 ? [(hb[0] + hb[2]) / 2, (hb[1] + hb[3]) / 2] : [(x0 + x1) / 2, y0] },
      eyes: { parent: "face" }, brows: { parent: "face" }, mouth: { parent: "face" },
      hand: { parent: "body", pivot: handB ? [(handB[0] + handB[2]) / 2, handB[3]] : [(x0 + x1) / 2, (y0 + y1) / 2] },
    };
    const colours = { line: f.line, hair: hair ? hair.base : undefined, lid: mask ? mask.base : skin ? skin.base : undefined,
      skinShade: skin ? skin.shade : undefined };
    cache[fid] = { f, list, inner, mask, colours, def };
    return cache[fid];
  }
  // the face box the tracer used (its faceBox), else the head's box
  const faceBox = (f) => f.faceBox || f.box;

  // The figure with face params p (kite-face.js) and a rig pose p.pose ({ head: { rot, dx, dy }, hand: { rot } …});
  // p.tilt (degrees) leans the head about its neck.
  function build(fid, p = {}) {
    const R = regions(fid), f = R.f;
    const ops = [{ kind: "fill", pts: [[-200, -200], [1224, -200], [1224, 1224], [-200, 1224]], mat: cel(f.bg, f.bg, { lineW: 0, shadow: 0 }), seed: 1 }];
    const face = f.face ? NS.face(f.face, p, R.colours) : { brows: [], face: [] };
    for (const s of R.list) {
      if (s === R.mask) ops.push(...face.brows);   // the brows go under the mask, as painted
      ops.push(s.op);
    }
    ops.push(...R.inner);
    if (!R.mask) ops.push(...face.brows);
    ops.push(...face.face);
    const pose = Object.assign({}, p.pose || {});
    if (num(p.tilt, 0)) pose.head = Object.assign({}, pose.head, { rot: num((pose.head || {}).rot, 0) + num(p.tilt, 0) });
    return { ops, world: [1024, 1024], rig: { def: R.def, pose } };
  }
  // The face params a figure is painted with (its face record's paint): a variant's defaults.
  const painted = (fid) => { const f = SHAPES()[fid]; return (f && f.face && f.face.paint) || {}; };
  // Milo's outfit switch: the identity front in his hero suit or in his civilian clothes (the same body, pose and face).
  const OUTFIT = { hero: "front", civilian: "civilian" };
  const frontBuild = (dflt) => (p = {}) => build(OUTFIT[p.outfit] || dflt, p);

  // ---------- the catalog ----------
  // A crop of a sheet scored at `scale` (the variant's world is its frame × scale; the figure is drawn in sheet pixels).
  function crop(box, scale) {
    const [x0, y0, x1, y1] = box;
    return { kind: "mapped", frame: [x0, y0, x1 - x0, y1 - y0], scale, fit: { s: scale, tx: -x0 * scale, ty: -y0 * scale } };
  }
  function figure(id, label, fid, scale, extra) {
    const f = SHAPES()[fid];
    return Object.assign({ id, label, sheet: SHEET_OF[f.sheet], build: (p) => build(fid, p) }, crop(f.box, scale), extra || {});
  }
  // Parts of the identity painting, each its own crop of the whole front figure.
  const IDENTITY_PARTS = [
    ["kite-head", "Head and hair", [418, 8, 592, 212], 1.2],
    ["kite-mask", "Mask and eyes", [448, 92, 562, 158], 2.4],
    ["kite-torso", "Torso and emblem", [380, 205, 640, 430], 0.9],
    ["kite-belt", "Belt", [420, 400, 595, 468], 1.4],
    ["kite-cape", "Cape", [320, 195, 700, 665], 0.55],
    ["kite-arm-r", "Arm and glove (his right)", [282, 215, 432, 615], 0.8],
    ["kite-arm-l", "Arm and glove (his left)", [583, 215, 731, 615], 0.8],
    ["kite-legs", "Legs and boots", [300, 600, 720, 1000], 0.55],
  ];
  const parts = [
    () => ({
      id: ID, label: "Whole", icon: "figure", anim: "blink", whole: true,
      variants: [
        Object.assign(figure("kite-front", "Front · identity sheet", "front", 0.5), { build: frontBuild("front") }),
        Object.assign(figure("kite-civilian", "Milo · civilian sheet", "civilian", 0.5), { build: frontBuild("civilian") }),
        figure("kite-turn-front", "Front · turnaround", "turn-front", 0.75),
        figure("kite-turn-3q", "Three-quarter · turnaround", "turn-3q", 0.75),
        figure("kite-turn-side", "Side · turnaround", "turn-side", 0.75),
        figure("kite-turn-back", "Back · turnaround", "turn-back", 0.75),
      ],
    }),
    () => ({
      id: "kite-parts", label: "Parts", icon: "body", anim: "blink",
      variants: IDENTITY_PARTS.map(([id, label, box, scale]) => Object.assign({ id, label, sheet: "kite-identity", build: frontBuild("front") }, crop(box, scale))),
    }),
    () => ({
      id: "kite-expressions", label: "Expressions", icon: "head", anim: "blink",
      variants: [["neutral", "Neutral"], ["happy", "Happy"], ["surprised", "Surprised"], ["determined", "Determined"], ["sad", "Sad"], ["laughing", "Laughing"]]
        .map(([n, label]) => figure(`kite-expr-${n}`, label, `expr-${n}`, 0.7, { expr: n })),
    }),
    () => ({
      id: "kite-poses", label: "Poses", icon: "body", anim: "blink", whole: true,
      variants: [
        figure("kite-pose-walk", "Walking · side", "pose-walk", 0.75),
        figure("kite-pose-wave", "Waving", "pose-wave", 0.75),
        figure("kite-pose-sit", "Sitting on a box", "pose-sit", 0.75),
        figure("kite-pose-lookup", "Looking up", "pose-lookup", 0.75),
        figure("kite-pose-landing", "Hero landing", "landing", 0.6),
        figure("kite-pose-flying", "Flying", "flying", 0.6),
      ],
    }),
  ];

  // ---------- the face's presets, mouths and sliders (the lab's expression buttons) ----------
  const expressions = {
    presets: {
      painted: { label: "As painted", p: { mouth: "painted" } },
      neutral: { label: "Neutral", p: { mouth: "smile", eyes: "open", brows: "neutral" } },
      happy: { label: "Happy", p: { mouth: "happy", eyes: "open", brows: "raised" } },
      surprised: { label: "Surprised", p: { mouth: "surprised", eyes: "wide", brows: "high" } },
      determined: { label: "Determined", p: { mouth: "grim", eyes: "open", brows: "determined" } },
      sad: { label: "Sad", p: { mouth: "frown", eyes: "open", brows: "sad", lookY: 0.4 } },
      laughing: { label: "Laughing", p: { mouth: "laugh", eyes: "happy", brows: "raised", blush: "soft" } },
      wink: { label: "Wink", p: { eyeR: "wink", mouth: "grin", brows: "raised" } },
      sleepy: { label: "Sleepy", p: { eyes: "closed", mouth: "smile", brows: "sleepy" } },
      "look-left": { label: "Look left", p: { look: -1, mouth: "smile" } },
      "look-right": { label: "Look right", p: { look: 1, mouth: "smile" } },
    },
    mouths: { painted: "As painted", smile: "Smile", grin: "Grin", happy: "Happy open", laugh: "Laugh", open: "Open", o: "“o”", surprised: "Surprised O",
      tongue: "Tongue out", frown: "Frown", grim: "Set jaw" },
    sliders: [["smile", "Smile", -1, 1.5], ["mouthOpen", "Mouth open", 0, 1], ["blush", "Blush", 0, 1]],
    rest: { smile: 0, mouthOpen: 0, mouthRound: 0, blush: 0, happy: 0 },
    build: (p) => frontBuild("front")(p),
  };

  // ---------- rig and clips ----------
  const rig = { parts: ["body", "head", "face", "eyes", "brows", "mouth", "hand"] };
  const clips = [
    { id: "kite-blink", label: "Blink twice", group: "eyes", dur: 1.4,
      p: { lid: [[0, 0], [0.1, 1, "in"], [0.24, 0, "out"], [0.55, 0], [0.65, 1, "in"], [0.79, 0, "out"]] } },
    { id: "kite-wave", label: "Wave (the waving pose's hand)", group: "head", dur: 1.2, loop: true,
      p: { mouth: "happy" },
      pose: { hand: { rot: [[0, -8, "sine"], [0.3, 12, "sine"], [0.6, -8, "sine"], [0.9, 12, "sine"], [1.2, -8, "sine"]] },
        head: { rot: [[0, 0], [0.6, 2, "sine"], [1.2, 0, "sine"]] } } },
  ];

  // anim.html's zooms (film --zoom=head): boxes [x, y, w, h] in the front figure's model units (sheet pixels from
  // its crop's corner, x 0.5), the figure the filmstrips use by default
  const lab = { filmZooms: { head: [67, 0, 86, 105], face: [85, 42, 55, 48], eyes: [87, 46, 48, 24], mouth: [99, 74, 27, 14] } };

  NS.build = build;
  NS.regions = regions;
  NS.SHEETS = SHEETS;
  CharacterLab.lab.registerCharacter({ id: ID, label: "Captain Kite", sheetsBase: "/packs/captain-kite/sheets/", sheets: SHEETS, parts, prefix: "kite-",
    expressions, rig, clips, lab });
})();

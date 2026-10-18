// Captain Kite's scenario (lab/scenarios.html): a rooftop take-off. A flat cel city rooftop against a sky drawn in
// code; `wind` streams the flag out from the pole, flies a toy kite higher and leans Kite into it; `lift` raises him off
// the roof while his shadow shrinks and fades, so the sweep shows whether his boots meet the floor at lift 0. The flag
// and the toy kite's tail flutter with the page's time. The rig has no cape part, so the cape stays as painted.
// Scene units: a 960 x 600 frame, y down; the roof's floor line is y = 462.
(function () {
  const CharacterLab = window.CharacterLab;
  const { ellipse } = CharacterLab.lab.geom;
  const INK = "#081212";
  const FLOOR = 462, EDGE = 712;
  const cel = (base, shade, o) => Object.assign({ type: 8, ramp: [shade || base, shade || base, base, base], clean: true, rim: 0, lineW: 0, shadow: 0 }, o);
  const inked = (base, shade, o) => cel(base, shade, Object.assign({ line: INK, lineW: 2, shadow: 6 }, o));
  const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  let seed = 1;
  const fill = (pts, mat) => ({ kind: "fill", pts, mat, seed: seed++ });

  // The sky in flat bands, a soft sun, two clouds and the city far off.
  function sky() {
    const ops = [
      fill(rect(-20, -20, 980, 620), cel("#8fcfea")),
      fill(rect(-20, 250, 980, 620), cel("#acdcef")),
      fill(rect(-20, 360, 980, 620), cel("#cbe9f3")),
      { kind: "halo", pts: ellipse(820, 92, 70, 70), tint: "#fff3cf", amt: 0.6, mat: { soft: 40, radius: 10 }, seed: seed++ },
      fill(ellipse(820, 92, 30, 30), cel("#fff8e2")),
    ];
    for (const [cx, cy, s] of [[210, 120, 1], [600, 205, 0.7]]) {
      for (const [dx, dy, rx, ry] of [[-48, 8, 34, 22], [-10, -8, 42, 32], [34, 2, 36, 26], [64, 12, 24, 16]])
        ops.push(fill(ellipse(cx + dx * s, cy + dy * s, rx * s, ry * s), cel("#ffffff", "#d8ecf6", { shadow: 7 * s, light: -2.2 })));
      ops.push(fill(rect(cx - 76 * s, cy + 12 * s, cx + 84 * s, cy + 26 * s), cel("#ffffff")));
    }
    // two rows of towers: the far one paler
    const towers = (row, colour, base) => row.forEach(([x, w, h]) => ops.push(fill(rect(x, base - h, x + w, 620), cel(colour))));
    towers([[690, 60, 190], [760, 44, 240], [812, 70, 160], [890, 52, 210], [-10, 70, 200], [80, 56, 250], [250, 80, 180], [420, 60, 230], [560, 70, 200]], "#b9d8e6", 600);
    towers([[724, 70, 150], [800, 54, 110], [858, 64, 175], [930, 50, 120]], "#93bccf", 600);
    for (const [x, w, h] of [[736, 46, 140], [870, 40, 165]])
      for (let y = 600 - h + 14; y < 590; y += 22) ops.push(fill(rect(x, y, x + w, y + 8), cel("#b4d6e4")));
    return ops;
  }

  // The roof: a slab you see a little from above, the building's face below it, a vent and the flagpole's foot.
  function roof() {
    const ops = [
      fill([[-20, 476], [EDGE, 476], [EDGE, 620], [-20, 620]], inked("#5f7486", "#4d6072", { shadow: 0 })),
      fill([[-20, 444], [EDGE - 8, 444], [EDGE + 6, 478], [-20, 478]], inked("#e4ded3", "#c9c1b4", { shadow: 5, light: -1.57 })),
    ];
    for (let x = 30; x < EDGE - 40; x += 92) ops.push(fill(rect(x, 506, x + 54, 556), inked("#2f3e4c", "#2f3e4c", { lineW: 1.5 })), fill(rect(x + 6, 512, x + 22, 528), cel("#f6d77a")));
    // a vent box with its cap, and a pipe
    ops.push(fill(rect(262, 418, 330, 458), inked("#c3cbd2", "#98a4ae", { shadow: 10 })));
    ops.push(fill(rect(256, 410, 336, 420), inked("#dfe5ea", "#b6c0c8")));
    ops.push(fill(rect(352, 396, 362, 456), inked("#c3cbd2", "#98a4ae", { shadow: 3 })));
    ops.push(fill(ellipse(357, 396, 9, 4), inked("#7b8791")));
    return ops;
  }

  // The flag: a cloth hoisted on the pole that hangs at no wind and streams out at full wind, rippling as it goes.
  // u, v in [0, 1] over the cloth (u along the fly, v down the hoist) to a point in the scene.
  const POLE = 140, TOP = 238, HOIST = 56, FLY = 104;
  function flagPoint(w, t) {
    const droop = (1 - w) * 1.32 + 0.08, amp = 2 + 8 * w, waves = 1.2 + 0.8 * w, phase = t * (2 + 7 * w);
    return (u, v) => {
      const a = droop * (0.35 + 0.65 * u), d = [Math.cos(a), Math.sin(a)], n = [-d[1], d[0]];
      const r = amp * u * Math.sin(2 * Math.PI * (waves * u - phase));
      return [POLE + u * FLY * d[0] + n[0] * r, TOP + 4 + v * HOIST + u * FLY * d[1] + n[1] * r];
    };
  }
  function flag(w, t) {
    const P = flagPoint(w, t), N = 14, edge = (v) => Array.from({ length: N + 1 }, (_, i) => P(i / N, v));
    const cloth = [...edge(0), ...edge(1).reverse()];
    const diamond = [P(0.5, 0.18), P(0.68, 0.5), P(0.5, 0.82), P(0.32, 0.5)];
    return [
      fill(rect(POLE - 3, TOP, POLE + 3, FLOOR - 4), inked("#d9dee3", "#a8b1b9", { shadow: 2.5, lineW: 1.5 })),
      fill(ellipse(POLE, TOP - 4, 7, 7), inked("#ffd23f", "#e0a51c", { shadow: 3, lineW: 1.5 })),
      fill(cloth, inked("#0ca09c", "#086e6f", { shadow: 9, light: -2.4 })),
      fill(diamond, inked("#ffd23f", "#e0a51c", { lineW: 1.2, shadow: 0 })),
      fill(rect(POLE - 12, FLOOR - 8, POLE + 12, FLOOR), inked("#a8b1b9", "#7f8a93", { shadow: 0, lineW: 1.5 })),
    ];
  }

  // A toy kite over the street: higher and steadier with more wind, its tail of bows trailing behind.
  function toyKite(w, t) {
    const cx = 790 + 30 * w, cy = 250 - 120 * w + 6 * Math.sin(t * 2.3), tilt = -0.5 + 0.35 * w + 0.08 * Math.sin(t * 3.1);
    const rot = ([x, y]) => [cx + x * Math.cos(tilt) - y * Math.sin(tilt), cy + x * Math.sin(tilt) + y * Math.cos(tilt)];
    const [kx, ky] = rot([0, 30]);
    const ops = [fill([[kx, ky], [980, 470], [980, 471.4], [kx + 1.4, ky]], cel("#3c4a56"))];   // its string, down to the street
    ops.push(fill([[0, -36], [24, -4], [0, 36], [-24, -4]].map(rot), inked("#fb7413", "#c14e0c", { shadow: 8 })));
    ops.push(fill([[0, -36], [24, -4], [0, -4]].map(rot), inked("#ffd23f", "#e0a51c", { lineW: 0, shadow: 0 })));
    for (let i = 1; i <= 4; i++) {
      const [bx, by] = rot([-10 * i - 4 * Math.sin(t * 4 + i) * (1.2 - w), 36 + 18 * i]);
      ops.push(fill([[bx - 6, by - 4], [bx + 6, by + 4], [bx + 6, by - 4], [bx - 6, by + 4]], inked(i % 2 ? "#0ca09c" : "#ffffff", null, { lineW: 1.2, shadow: 0 })));
    }
    return ops;
  }

  // Kite leans into the wind (it blows from the left) about his left boot's heel, so that boot stays on the roof: the
  // rig turns his body about its own pivot (between his feet), and this moves it back by what that turn shifts the heel.
  function lean(deg) {
    const pivot = CharacterLab.captainKite.regions("front").def.body.pivot, heel = [352, 991];
    const th = (deg * Math.PI) / 180, c = Math.cos(th), s = Math.sin(th), vx = heel[0] - pivot[0], vy = heel[1] - pivot[1];
    return { rot: deg, dx: vx - (c * vx - s * vy), dy: vy - (s * vx + c * vy) };
  }

  CharacterLab.scenarios.register({
    id: "kite-rooftop", label: "Rooftop take-off", pack: "captain-kite",
    world: [960, 600],
    params: {
      wind: { label: "Wind", min: 0, max: 1, step: 0.01, value: 0.45 },
      lift: { label: "Lift", min: 0, max: 140, step: 1, value: 0, unit: "u" },
    },
    slots: [{ id: "roof", label: "Roof", x: 540, y: FLOOR, w: 180 }],
    build(p, ctx) {
      seed = 1;
      const u = p.lift / 140, sx = 540;
      const shadow = { kind: "shadow", pts: ellipse(sx, FLOOR + 1, 54 * (1 - 0.55 * u), 8 * (1 - 0.35 * u)), off: [0, 0], tint: "#2e3d4c",
        amt: 0.5 * (1 - 0.75 * u), mat: { soft: 4 + 6 * u }, seed: seed++ };
      return { ops: [...sky(), ...toyKite(p.wind, ctx.t), ...roof(), shadow, ...flag(p.wind, ctx.t)] };
    },
    cast: (p) => [{ variant: "kite-front", slot: "roof", dy: -p.lift, h: 300, clip: "kite-blink", pose: { body: lean(-4 * p.wind) } }],
    notes: "Sweep lift: the shadow shrinks as the boots leave the roof, and at lift 0 they sit on the floor line. "
      + "Sweep wind: the flag streams out and Kite leans into it (his rig has no cape part, so the cape stays as painted).",
  });
})();

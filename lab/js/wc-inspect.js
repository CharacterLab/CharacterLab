// Inspect a whole figure part by part (its pack's named regions, vv.regions): the painting beside our render (and,
// with a baseline, the earlier version), a light map that shows where each is lit and shaded, and our shapes'
// outlines laid over the painting. Everything lands on one canvas (#shot) so scripts/wc-lab.mjs can screenshot it.
//   inspect.html                        every named part of the first figure that has regions, worst first
//   inspect.html?v=<variant id>         another figure
//   inspect.html?region=footL           one part, large (&k=zoom, &grid=5, &outlines=1, &map=light|diff)
//   inspect.html?box=60,300,130,344     any box in the painting's pixels
//   &baseline=1                         also the version in lab/_baseline/ (its files.json lists the scripts a
//                                       pack's baseline script copied from a git ref)
(async function () {
  const CharacterLab = window.CharacterLab, C = CharacterLab.wcCompare, E = CharacterLab.wcElements, R = CharacterLab.wcRegions;
  const qs = new URLSearchParams(location.search);
  const all = E.parts.flatMap((p) => p.variants), vid = qs.get("v");
  const vv = vid ? all.find((v) => v.id === vid) : all.find((v) => v.regions && v.build);
  if (!vv || !vv.regions) throw new Error(vid ? `${vid}: no such variant with named regions` : (E.parts.length ? "no figure with named regions (a pack's vv.regions)" : "no character packs found; see packs/README.md"));
  C.setTrace(E.trace(vv));
  const img = await C.loadRef();
  const SS = 3;

  // our render at the painting's size (as scored) and at zoom k inside a box
  function render(build, view, w, h) {
    const g = document.createElement("canvas"); g.width = w; g.height = h;
    const r = CharacterLab.wcGL.create(g); r.render(build({}), view);
    const c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d").drawImage(g, 0, 0);
    const lose = r.gl.getExtension("WEBGL_lose_context"); if (lose) lose.loseContext();
    return c;
  }
  const figure = (build) => {
    const g = render(build, { scale: SS, ox: 0, oy: 0 }, C.FW * SS, C.FH * SS);
    return C.figureCanvas((x) => { x.imageSmoothingQuality = "high"; x.drawImage(g, 0, 0, C.FW, C.FH); });
  };
  const crop = (build, b, k) => render(build, { scale: k, ox: -b[0] * k, oy: -b[1] * k }, Math.round((b[2] - b[0]) * k), Math.round((b[3] - b[1]) * k));
  const refCrop = (b, k) => {
    const c = document.createElement("canvas"); c.width = Math.round((b[2] - b[0]) * k); c.height = Math.round((b[3] - b[1]) * k);
    const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.imageSmoothingQuality = "high";
    C.drawRef(x, img, { scale: k, ox: -b[0] * k, oy: -b[1] * k }); return c;
  };
  // light map: luminance blurred a little, stretched around the part's median so shading reads clearly
  function lightMap(src) {
    const w = src.width, h = src.height, d = src.getContext("2d").getImageData(0, 0, w, h).data, Y = new Float32Array(w * h);
    for (let p = 0, o = 0; p < w * h; p++, o += 4) Y[p] = 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2];
    const sorted = Float32Array.from(Y).sort(), med = sorted[sorted.length >> 1], r = Math.max(1, Math.round(w / 120));
    const out = document.createElement("canvas"); out.width = w; out.height = h;
    const x = out.getContext("2d"), id = x.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) {
      let s = 0, n = 0;
      for (let j = -r; j <= r; j += r) for (let i = -r; i <= r; i += r) { const X = xx + i, Yy = y + j; if (X < 0 || Yy < 0 || X >= w || Yy >= h) continue; s += Y[Yy * w + X]; n++; }
      const v = Math.max(0, Math.min(255, (s / n - med) * 4 + 128)), o = (y * w + xx) * 4;
      id.data[o] = id.data[o + 1] = id.data[o + 2] = v; id.data[o + 3] = 255;
    }
    x.putImageData(id, 0, 0); return out;
  }
  function diffMap(a, b) {
    const w = a.width, h = a.height, A = a.getContext("2d").getImageData(0, 0, w, h).data, B = b.getContext("2d").getImageData(0, 0, w, h).data;
    const out = document.createElement("canvas"); out.width = w; out.height = h;
    const x = out.getContext("2d"), id = x.createImageData(w, h);
    for (let i = 0; i < A.length; i += 4) { for (let k = 0; k < 3; k++) id.data[i + k] = 255 - Math.min(255, Math.abs(A[i + k] - B[i + k]) * 3); id.data[i + 3] = 255; }
    x.putImageData(id, 0, 0); return out;
  }
  // our shapes' outlines (fills and strokes inside the box), drawn over a crop
  function outlines(x, build, b, k, ox, oy) {
    x.save(); x.beginPath(); x.rect(ox, oy, (b[2] - b[0]) * k, (b[3] - b[1]) * k); x.clip();   // stay inside the panel
    x.lineWidth = 1; x.globalAlpha = 0.85;
    for (const op of build({}).ops) {
      if (!op.pts || !["fill", "stroke"].includes(op.kind)) continue;
      const inBox = op.pts.some(([px, py]) => px >= b[0] && px <= b[2] && py >= b[1] && py <= b[3]);
      if (!inBox) continue;
      x.strokeStyle = op.kind === "fill" ? "#00a8ff" : "#ff2a8a";
      x.beginPath(); op.pts.forEach(([px, py], i) => (i ? x.lineTo : x.moveTo).call(x, ox + (px - b[0]) * k, oy + (py - b[1]) * k));
      if (op.kind === "fill") x.closePath(); x.stroke();
    }
    x.restore();
  }
  function grid(x, b, k, ox, oy, w, h, step) {
    x.save(); x.font = "10px system-ui";
    for (let gx = Math.ceil(b[0] / step) * step; gx < b[2]; gx += step) { x.fillStyle = gx % (step * 2) ? "rgba(0,60,255,0.15)" : "rgba(0,60,255,0.4)"; x.fillRect(ox + (gx - b[0]) * k, oy, 1, h); x.fillText(gx, ox + (gx - b[0]) * k + 2, oy + 10); }
    for (let gy = Math.ceil(b[1] / step) * step; gy < b[3]; gy += step) { x.fillStyle = gy % (step * 2) ? "rgba(0,60,255,0.15)" : "rgba(0,60,255,0.4)"; x.fillRect(ox, oy + (gy - b[1]) * k, w, 1); x.fillText(gy, ox + 2, oy + (gy - b[1]) * k - 2); }
    x.restore();
  }
  const loadScript = (src) => new Promise((ok, bad) => { const s = document.createElement("script"); s.src = src + "?t=" + Date.now(); s.onload = ok; s.onerror = () => bad(new Error("missing " + src)); document.body.appendChild(s); });
  const build = (p) => vv.build(p);

  const shot = document.getElementById("shot"), x = shot.getContext("2d"), info = document.getElementById("info");
  const label = (t, px, py) => { x.fillStyle = "#2b2118"; x.font = "600 13px system-ui"; x.fillText(t, px, py); };
  const ref = C.figureCanvas((c) => C.drawRef(c, img, { scale: 1, ox: 0, oy: 0 })), ours = figure(build);
  const parts = R.measureAll(ours, ref, vv.regions);

  const name = qs.get("region"), boxQ = qs.get("box");
  if (name || boxQ) {
    const b = boxQ ? boxQ.split(",").map(Number) : vv.regions[name];
    if (!b) throw new Error("no such region: " + name);
    const k = +(qs.get("k") || Math.min(8, 520 / (b[2] - b[0]))), w = Math.round((b[2] - b[0]) * k), h = Math.round((b[3] - b[1]) * k);
    const panels = [["painting", refCrop(b, k)], ["ours", crop(build, b, k)]];
    if (qs.has("baseline")) {
      const files = await fetch("_baseline/files.json").then((r) => (r.ok ? r.json() : [])).catch(() => []);
      for (const f of files) await loadScript("_baseline/js/" + f).catch(() => {});
      panels.push(["baseline", crop(build, b, k)]);
    }
    const map = qs.get("map") || "light";
    if (map === "light") panels.push(["light: painting", lightMap(panels[0][1])], ["light: ours", lightMap(panels[1][1])]);
    if (map === "diff") panels.push(["|ours - painting|", diffMap(panels[1][1], panels[0][1])]);
    const cols = Math.min(panels.length, 3), rows = Math.ceil(panels.length / cols), gap = 10, top = 22;
    shot.width = cols * w + (cols + 1) * gap; shot.height = rows * (h + top) + gap;
    x.fillStyle = "#fbf7f0"; x.fillRect(0, 0, shot.width, shot.height);
    panels.forEach(([t, c], i) => {
      const px = gap + (i % cols) * (w + gap), py = top + Math.floor(i / cols) * (h + top);
      label(t, px, py - 6); x.drawImage(c, px, py);
      if (qs.has("outlines") && (t === "painting" || t === "ours")) outlines(x, build, b, k, px, py);
      if (qs.has("grid")) grid(x, b, k, px, py, w, h, +qs.get("grid") || 5);
    });
    const m = parts.find((p) => p.name === name) || Object.assign({ name: "box" }, CharacterLab.wcRegionMath.measure(ours.getContext("2d").getImageData(0, 0, C.FW, C.FH).data, ref.getContext("2d").getImageData(0, 0, C.FW, C.FH).data, C.FW, C.FH, b));
    info.textContent = JSON.stringify(m);
  } else {
    // overview: every part, worst first: painting | ours, with its score
    const tw = 120, cols = 4, cell = tw * 2 + 30, rowH = 150;
    shot.width = cols * cell + 20; shot.height = Math.ceil(parts.length / cols) * rowH + 20;
    x.fillStyle = "#fbf7f0"; x.fillRect(0, 0, shot.width, shot.height);
    parts.forEach((p, i) => {
      const b = p.box, k = Math.min(tw / (b[2] - b[0]), 110 / (b[3] - b[1])), px = 10 + (i % cols) * cell, py = 30 + Math.floor(i / cols) * rowH;
      label(`${p.name}  ${p.score}  (ΔE ${p.dE}, SSIM ${p.ssim})`, px, py - 8);
      x.drawImage(refCrop(b, k), px, py); x.drawImage(crop(build, b, k), px + tw + 6, py);
    });
    info.textContent = JSON.stringify(parts.map(({ name, score }) => ({ name, score })));
  }
  document.title = "READY";
})().catch((e) => { document.title = "ERROR " + e.message; console.error(e); });

// Reference alignment + scores. Both images are compared in figure space (the reference's own pixels), over white.
// A whole figure (a "trace" variant) is scored with landmarks and silhouette first, pixels last:
//   fidelity = 0.30 landmarks + 0.25 silhouette + 0.15 palette + 0.10 feature shapes + 0.10 SSIM + 0.10 texture
// Its landmarks come from the character's pack: trace.scorer = { analyze(data, w, h) -> { ink, dark, pink, sat, … },
// landmarks(A, B) -> { score 0..1, rows }, regions(trace, figure) -> { name: [x0, y0, x1, y1] } } (same rules for both
// images; CharacterLab.wcCompare.components finds the blobs). A trace without one is scored on its colour masks alone, the
// silhouette standing in for the landmarks.
(function () {
  const CharacterLab = window.CharacterLab;
  let TR = () => { throw new Error("wcCompare: setTrace(trace) first"); };   // the current variant's trace
  const fig = () => TR().figure;
  const WS = () => { const f = fig(), s = f.scale || 1; return [Math.round(f.w * s), Math.round(f.h * s)]; };  // world size
  function setTrace(t) { TR = () => t; refImg = null; }
  // A sheet file as a URL: a pack's sheets come as absolute paths (js/lab-packs.js: sheetsBase + file); a bare file
  // name (a trace's figure.sheet) is resolved by the pack that knows it (registerCharacter's sheetUrl).
  CharacterLab.wcSheetUrl = (file) => (CharacterLab.lab && CharacterLab.lab.sheetUrl ? CharacterLab.lab.sheetUrl(file) : file);
  const refSrc = () => CharacterLab.wcSheetUrl(fig().sheet);

  let refImg = null;
  function loadRef() {
    if (refImg) return refImg;
    refImg = new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error("reference not found: " + refSrc()));
      img.src = refSrc();
    });
    return refImg;
  }
  // Draw the reference figure into ctx at world->canvas view {scale, ox, oy}.
  function drawRef(ctx, img, view) {
    const f = fig(), s = f.scale || 1;
    ctx.drawImage(img, f.x0, f.y0, f.w, f.h, view.ox, view.oy, f.w * s * view.scale, f.h * s * view.scale);
  }
  function figureCanvas(drawFn) {
    const c = document.createElement("canvas");
    [c.width, c.height] = WS();
    const x = c.getContext("2d", { willReadFrequently: true });
    x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height);
    drawFn(x);
    return c;
  }
  // Mask boxes of the current trace (trace.mask = [[x0, y0, x1, y1], …] in crop pixels, from the variant's `mask` in
  // wc-elements.js): a sheet's label or a neighbour's edge inside the crop. They are painted white in both images
  // before scoring, so no drawing is asked to reproduce them. Malformed boxes are ignored; boxes are clipped.
  function maskBoxes() {
    const m = TR().mask, s = fig().scale || 1, [FW, FH] = WS();
    if (!Array.isArray(m)) return [];
    const clip = (v, hi) => Math.max(0, Math.min(hi, Math.round(v * s)));
    return m.filter((b) => Array.isArray(b) && b.length === 4 && b.every(Number.isFinite))
      .map(([x0, y0, x1, y1]) => [clip(x0, FW), clip(y0, FH), clip(x1, FW), clip(y1, FH)])
      .filter(([x0, y0, x1, y1]) => x1 > x0 && y1 > y0);
  }
  // A figure canvas's pixels (a fresh copy), with the mask boxes painted white.
  function figurePixels(cv) {
    const [FW, FH] = WS(), d = cv.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, FW, FH).data;
    for (const [x0, y0, x1, y1] of maskBoxes()) for (let y = y0; y < y1; y++) d.fill(255, (y * FW + x0) * 4, (y * FW + x1) * 4);
    return d;
  }

  // ---------- colour maths ----------
  function srgbToLab(r, g, b) {
    const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const R = f(r), G = f(g), B = f(b);
    let X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, Y = R * 0.2126 + G * 0.7152 + B * 0.0722, Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
    const h = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    X = h(X); Y = h(Y); Z = h(Z);
    return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
  }
  function downsample(data, w, h, k) {
    const W = Math.floor(w / k), H = Math.floor(h / k), out = new Float32Array(W * H * 3);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0;
      for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) { const o = ((y * k + j) * w + x * k + i) * 4; r += data[o]; g += data[o + 1]; b += data[o + 2]; }
      const n = k * k, o = (y * W + x) * 3;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
    }
    return { d: out, w: W, h: H };
  }
  function ssimBlocks(A, B, w, box, win = 8, step = 4) {
    const C1 = 6.5025, C2 = 58.5225; let s = 0, n = 0;
    const [x0, y0, x1, y1] = box;
    for (let y = y0; y + win <= y1; y += step) for (let x = x0; x + win <= x1; x += step) {
      let ma = 0, mb = 0;
      for (let j = 0; j < win; j++) for (let i = 0; i < win; i++) { const o = (y + j) * w + x + i; ma += A[o]; mb += B[o]; }
      const N = win * win; ma /= N; mb /= N;
      if (ma > 250 && mb > 250) continue;
      let va = 0, vb = 0, cv = 0;
      for (let j = 0; j < win; j++) for (let i = 0; i < win; i++) { const o = (y + j) * w + x + i; const a = A[o] - ma, b = B[o] - mb; va += a * a; vb += b * b; cv += a * b; }
      va /= N - 1; vb /= N - 1; cv /= N - 1;
      s += ((2 * ma * mb + C1) * (2 * cv + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2)); n++;
    }
    return n ? s / n : 1;
  }

  // ---------- pixel landmarks (same rules for both images) ----------
  function components(mask, w, h, box, minPx) {
    const [x0, y0, x1, y1] = box, lab = new Int32Array(w * h), out = [];
    let next = 1;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const o = y * w + x;
      if (!mask[o] || lab[o]) continue;
      const stack = [o]; lab[o] = next;
      let n = 0, sx = 0, sy = 0, bx0 = x, bx1 = x, by0 = y, by1 = y;
      while (stack.length) {
        const q = stack.pop(), qx = q % w, qy = (q / w) | 0;
        n++; sx += qx; sy += qy;
        if (qx < bx0) bx0 = qx; if (qx > bx1) bx1 = qx; if (qy < by0) by0 = qy; if (qy > by1) by1 = qy;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = qx + dx, ny = qy + dy;
          if (nx < x0 || nx >= x1 || ny < y0 || ny >= y1) continue;
          const nq = ny * w + nx;
          if (mask[nq] && !lab[nq]) { lab[nq] = next; stack.push(nq); }
        }
      }
      if (n >= minPx) out.push({ n, cx: sx / n, cy: sy / n, x0: bx0, x1: bx1, y0: by0, y1: by1 });
      next++;
    }
    return out.sort((a, b) => b.n - a.n);
  }
  const iou = (a, b) => { let i = 0, u = 0; for (let k = 0; k < a.length; k++) { if (a[k] && b[k]) i++; if (a[k] || b[k]) u++; } return u ? i / u : 1; };

  // Texture inside box: mean 6x6 block contrast and mean gradient energy (paper-white pixels skipped).
  function texStats(Y, FW, box) {
    const [x0, y0, x1, y1] = box; let sd = 0, nb = 0, ge = 0, ng = 0;
    for (let y = y0; y + 6 <= y1; y += 6) for (let x = x0; x + 6 <= x1; x += 6) {
      let m = 0; for (let j = 0; j < 6; j++) for (let i = 0; i < 6; i++) m += Y[(y + j) * FW + x + i];
      m /= 36; if (m > 248) continue;
      let v = 0; for (let j = 0; j < 6; j++) for (let i = 0; i < 6; i++) { const d = Y[(y + j) * FW + x + i] - m; v += d * d; }
      sd += Math.sqrt(v / 36); nb++;
    }
    for (let y = y0 + 1; y < y1 - 1; y++) for (let x = x0 + 1; x < x1 - 1; x++) {
      const o = y * FW + x; if (Y[o] > 248) continue;
      ge += Math.abs(Y[o + 1] - Y[o - 1]) + Math.abs(Y[o + FW] - Y[o - FW]); ng++;
    }
    return [sd / Math.max(nb, 1), ge / Math.max(ng, 1)];
  }

  // One element on its own (no landmarks): the same rules for both images.
  //   fidelity = 0.35 silhouette + 0.25 palette + 0.20 SSIM + 0.20 texture
  function scoreElement(ours, ref) {
    const [FW, FH] = WS(), N = FW * FH;
    const a = figurePixels(ours), b = figurePixels(ref);
    const YA = new Float32Array(N), YB = new Float32Array(N), MA = new Uint8Array(N), MB = new Uint8Array(N);
    const ink = (d, i, L) => { const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]); return L < 236 || (mx - mn) / Math.max(mx, 1) > 0.1 ? 1 : 0; };
    // The texture box is the painting's ink box before masking: a mask then takes only its own pixels out of the
    // texture statistics (they are white in both images) and does not move their 6-px block grid.
    const raw = maskBoxes().length ? ref.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, FW, FH).data : b;
    let bx0 = FW, by0 = FH, bx1 = 0, by1 = 0;
    for (let i = 0, p = 0; p < N; i += 4, p++) {
      YA[p] = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
      YB[p] = 0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2];
      MA[p] = ink(a, i, YA[p]); MB[p] = ink(b, i, YB[p]);
      const boxInk = raw === b ? MB[p] : ink(raw, i, 0.299 * raw[i] + 0.587 * raw[i + 1] + 0.114 * raw[i + 2]);
      if (boxInk) { const x = p % FW, y = (p / FW) | 0; if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
    }
    const sil = iou(MA, MB);
    const k = 4, da = downsample(a, FW, FH, k), db = downsample(b, FW, FH, k);
    let dE = 0, n = 0;
    for (let i = 0; i < da.d.length; i += 3) {
      if (da.d[i] + da.d[i + 1] + da.d[i + 2] > 750 && db.d[i] + db.d[i + 1] + db.d[i + 2] > 750) continue;
      const la = srgbToLab(da.d[i], da.d[i + 1], da.d[i + 2]), lb = srgbToLab(db.d[i], db.d[i + 1], db.d[i + 2]);
      dE += Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]); n++;
    }
    dE /= Math.max(n, 1);
    const ssim = ssimBlocks(YA, YB, FW, [0, 0, FW, FH]);
    const box = [bx0, by0, bx1 + 1, by1 + 1];
    const sa = texStats(YA, FW, box), sb = texStats(YB, FW, box);
    const contrast = sa[0] / Math.max(sb[0], 1e-3), edges = sa[1] / Math.max(sb[1], 1e-3);
    const tex = Math.exp(-2 * Math.abs(Math.log(contrast))) * Math.exp(-2 * Math.abs(Math.log(edges)));
    const palette = Math.exp(-dE / 12), ssimN = Math.max(0, Math.min(1, (ssim - 0.1) / 0.6));
    const fidelity = 100 * (0.35 * sil + 0.25 * palette + 0.2 * ssimN + 0.2 * tex);
    return { fidelity: +fidelity.toFixed(1), iou: +sil.toFixed(4), dE4: +dE.toFixed(2), palette: +palette.toFixed(3), ssim: +ssim.toFixed(4),
      contrast: +contrast.toFixed(2), edges: +edges.toFixed(2), texture: +tex.toFixed(3) };
  }

  // A trace without its pack's scorer: the colour masks (the same pixel rules as a face's), no landmarks (the
  // silhouette's overlap stands in for them) and the whole figure as one region.
  function masks(data, w, h) {
    const N = w * h, ink = new Uint8Array(N), dark = new Uint8Array(N), pink = new Uint8Array(N), sat = new Uint8Array(N);
    for (let i = 0, p = 0; p < N; i += 4, p++) {
      const r = data[i], g = data[i + 1], b = data[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const L = 0.299 * r + 0.587 * g + 0.114 * b, S = (mx - mn) / Math.max(mx, 1);
      ink[p] = 765 - r - g - b > 25; dark[p] = L < 90; pink[p] = r > 170 && r - b > 45 && r - g > 35; sat[p] = S > 0.45 && L > 60 && L < 160;
    }
    return { ink, dark, pink, sat };
  }
  const PLAIN = { analyze: masks, landmarks: (A, B) => ({ score: iou(A.ink, B.ink), rows: [] }), regions: (t, f) => ({ figure: [0, 0, f.w, f.h] }) };
  const scorer = () => TR().scorer || PLAIN;

  function score(ours, ref) {
    const [FW, FH] = WS();
    const a = figurePixels(ours), b = figurePixels(ref);
    const YA = new Float32Array(FW * FH), YB = new Float32Array(FW * FH);
    let dE = 0, nE = 0;
    for (let i = 0, p = 0; i < a.length; i += 4, p++) {
      YA[p] = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
      YB[p] = 0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2];
    }
    const k = 4, da = downsample(a, FW, FH, k), db = downsample(b, FW, FH, k);
    const REG = scorer().regions(TR(), fig()), regionDE = {}, regionN = {}, meanA = {}, meanB = {};
    let dE4 = 0, n4 = 0;
    for (let y = 0; y < da.h; y++) for (let x = 0; x < da.w; x++) {
      const o = (y * da.w + x) * 3;
      if (da.d[o] + da.d[o + 1] + da.d[o + 2] > 750 && db.d[o] + db.d[o + 1] + db.d[o + 2] > 750) continue;
      const la = srgbToLab(da.d[o], da.d[o + 1], da.d[o + 2]), lb = srgbToLab(db.d[o], db.d[o + 1], db.d[o + 2]);
      const e = Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
      dE4 += e; n4++;
      for (const [name, [x0, y0, x1, y1]] of Object.entries(REG)) {
        const X = x * k + 2, Y = y * k + 2;
        if (X >= x0 && X < x1 && Y >= y0 && Y < y1) {
          regionDE[name] = (regionDE[name] || 0) + e; regionN[name] = (regionN[name] || 0) + 1;
          const A_ = (meanA[name] = meanA[name] || [0, 0, 0]), B_ = (meanB[name] = meanB[name] || [0, 0, 0]);
          for (let q = 0; q < 3; q++) { A_[q] += la[q]; B_[q] += lb[q]; }
        }
      }
    }
    const k16 = 12, ea = downsample(a, FW, FH, k16), eb = downsample(b, FW, FH, k16);
    let dE16 = 0, n16 = 0;
    for (let i = 0; i < ea.d.length; i += 3) {
      if (ea.d[i] + ea.d[i + 1] + ea.d[i + 2] > 750 && eb.d[i] + eb.d[i + 1] + eb.d[i + 2] > 750) continue;
      const la = srgbToLab(ea.d[i], ea.d[i + 1], ea.d[i + 2]), lb = srgbToLab(eb.d[i], eb.d[i + 1], eb.d[i + 2]);
      dE16 += Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]); n16++;
    }
    const regions = {};
    let tex = 0;
    for (const name of Object.keys(REG)) {
      const sa = texStats(YA, FW, REG[name]), sb = texStats(YB, FW, REG[name]);
      const contrast = sa[0] / Math.max(sb[0], 1e-3), edges = sa[1] / Math.max(sb[1], 1e-3);
      const nn = regionN[name] || 1, fm = (v) => (v || [0, 0, 0]).map((x) => Math.round(x / nn));
      regions[name] = { dE4: +((regionDE[name] || 0) / nn).toFixed(2), ssim: +ssimBlocks(YA, YB, FW, REG[name]).toFixed(3), contrast: +contrast.toFixed(2), edges: +edges.toFixed(2), labOurs: fm(meanA[name]), labRef: fm(meanB[name]) };
      tex += Math.exp(-2 * Math.abs(Math.log(contrast))) * Math.exp(-2 * Math.abs(Math.log(edges)));
    }
    tex /= Object.keys(REG).length;
    const ssim = ssimBlocks(YA, YB, FW, [0, 0, FW, FH]);
    // landmarks + shapes from pixels, same rules for both images
    const sc = scorer(), A = sc.analyze(a, FW, FH), B = sc.analyze(b, FW, FH);
    const lmk = sc.landmarks(A, B);
    const sil = iou(A.ink, B.ink);
    const feat = (iou(A.dark, B.dark) + iou(A.pink, B.pink) + iou(A.sat, B.sat)) / 3;
    n16 = Math.max(n16, 1); n4 = Math.max(n4, 1);   // an all-white pair (nothing to compare) scores as a match
    const palette = Math.exp(-(dE16 / n16) / 12);
    const ssimN = Math.max(0, Math.min(1, (ssim - 0.1) / 0.6));
    const fidelity = 100 * (0.3 * lmk.score + 0.25 * sil + 0.15 * palette + 0.1 * feat + 0.1 * ssimN + 0.1 * tex);
    return {
      fidelity: +fidelity.toFixed(1), landmarks: +lmk.score.toFixed(3), iou: +sil.toFixed(4), palette: +palette.toFixed(3), features: +feat.toFixed(3),
      ssim: +ssim.toFixed(4), texture: +tex.toFixed(3), dE4: +(dE4 / n4).toFixed(2), dE16: +(dE16 / n16).toFixed(2), regions, landmarkRows: lmk.rows,
    };
  }
  // The ink bounding box of a crop of the sheet (crop-local pixels).
  function inkBox(img, [x0, y0, w, h]) {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(img, x0, y0, w, h, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h).data;
    let bx0 = w, by0 = h, bx1 = 0, by1 = 0;
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      const r = d[i], g = d[i + 1], b = d[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (0.299 * r + 0.587 * g + 0.114 * b < 236 || (mx - mn) / Math.max(mx, 1) > 0.1) { const X = p % w, Y = (p / w) | 0; bx0 = Math.min(bx0, X); bx1 = Math.max(bx1, X); by0 = Math.min(by0, Y); by1 = Math.max(by1, Y); }
    }
    return { x0: bx0, y0: by0, x1: bx1 + 1, y1: by1 + 1 };
  }
  // A "mapped" variant draws the whole-character model into another sheet's crop: vv.fit = { s, tx, ty } (crop-local),
  // or the name of a fit in CharacterLab.WC_FITS (default "standing", js/families/wc-fam-standing.js) computed from the image.
  function fitFor(img, vv) {
    if (vv.kind !== "mapped") return null;
    if (vv.fit && typeof vv.fit === "object") return vv.fit;
    const f = (CharacterLab.WC_FITS || {})[vv.fit || "standing"];
    return f ? f(img, vv, CharacterLab.wcCompare) : null;
  }
  function diffCanvas(ours, ref, gain = 3) {
    const [FW, FH] = WS();
    const c = document.createElement("canvas"); c.width = FW; c.height = FH;
    const x = c.getContext("2d");
    const A = figurePixels(ours), B = figurePixels(ref);   // masked boxes show no difference: they are not scored
    const out = x.createImageData(FW, FH);
    for (let i = 0; i < A.length; i += 4) {
      for (let k = 0; k < 3; k++) out.data[i + k] = 255 - Math.min(255, Math.abs(A[i + k] - B[i + k]) * gain);
      out.data[i + 3] = 255;
    }
    x.putImageData(out, 0, 0);
    return c;
  }

  CharacterLab.wcCompare = { loadRef, drawRef, figureCanvas, score, scoreElement, diffCanvas, components, iou, setTrace, inkBox, fitFor, get FW() { return WS()[0]; }, get FH() { return WS()[1]; } };
})();

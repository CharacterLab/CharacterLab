// Region metrics for the Character Lab: how one named part of our render compares with the same part of the
// painting. Pure maths on RGBA pixel arrays, so it runs in the browser (CharacterLab.wcRegionMath) and in Node tests.
//   dE        mean CIE76 colour difference over the part's ink pixels (0 = same colour; ~2 just visible)
//   ssim      structural similarity of luminance, 8x8 windows every 4 px (1 = same structure)
//   contrast  our 6x6 block contrast / the painting's (1 = same amount of light and dark)
//   edges     our gradient energy / the painting's (1 = same amount of edges)
//   L, chroma lightness and colourfulness, ours vs the painting: 5th, 50th and 95th percentiles of L
//   score     100 * (0.4 colour + 0.3 structure + 0.3 texture), the lab's element weights without silhouette
(function (root) {
  const PAPER_L = 248;

  function srgbToLab(r, g, b) {
    const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const R = f(r), G = f(g), B = f(b);
    const h = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const X = h((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047), Y = h(R * 0.2126 + G * 0.7152 + B * 0.0722), Z = h((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
    return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
  }
  const luma = (d, o) => 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2];

  function clampBox(box, w, h) {
    const [x0, y0, x1, y1] = box;
    return [Math.max(0, Math.floor(x0)), Math.max(0, Math.floor(y0)), Math.min(w, Math.ceil(x1)), Math.min(h, Math.ceil(y1))];
  }
  function lumaPlane(d, w, h) {
    const Y = new Float32Array(w * h);
    for (let p = 0, o = 0; p < w * h; p++, o += 4) Y[p] = luma(d, o);
    return Y;
  }
  function ssim(A, B, w, box) {
    const C1 = 6.5025, C2 = 58.5225, win = 8, N = win * win, [x0, y0, x1, y1] = box;
    let s = 0, n = 0;
    for (let y = y0; y + win <= y1; y += 4) for (let x = x0; x + win <= x1; x += 4) {
      let ma = 0, mb = 0;
      for (let j = 0; j < win; j++) for (let i = 0; i < win; i++) { const o = (y + j) * w + x + i; ma += A[o]; mb += B[o]; }
      ma /= N; mb /= N;
      if (ma > 250 && mb > 250) continue;
      let va = 0, vb = 0, cv = 0;
      for (let j = 0; j < win; j++) for (let i = 0; i < win; i++) { const o = (y + j) * w + x + i, a = A[o] - ma, b = B[o] - mb; va += a * a; vb += b * b; cv += a * b; }
      va /= N - 1; vb /= N - 1; cv /= N - 1;
      s += ((2 * ma * mb + C1) * (2 * cv + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2)); n++;
    }
    return n ? s / n : 1;
  }
  // [mean 6x6 block contrast, mean gradient energy] over non-paper pixels
  function texture(Y, w, box) {
    const [x0, y0, x1, y1] = box;
    let sd = 0, nb = 0, ge = 0, ng = 0;
    for (let y = y0; y + 6 <= y1; y += 6) for (let x = x0; x + 6 <= x1; x += 6) {
      let m = 0; for (let j = 0; j < 6; j++) for (let i = 0; i < 6; i++) m += Y[(y + j) * w + x + i];
      m /= 36; if (m > PAPER_L) continue;
      let v = 0; for (let j = 0; j < 6; j++) for (let i = 0; i < 6; i++) { const d = Y[(y + j) * w + x + i] - m; v += d * d; }
      sd += Math.sqrt(v / 36); nb++;
    }
    for (let y = Math.max(y0, 1); y < Math.min(y1, Y.length / w - 1); y++) for (let x = Math.max(x0, 1); x < Math.min(x1, w - 1); x++) {
      const o = y * w + x; if (Y[o] > PAPER_L) continue;
      ge += Math.abs(Y[o + 1] - Y[o - 1]) + Math.abs(Y[o + w] - Y[o - w]); ng++;
    }
    return [sd / Math.max(nb, 1), ge / Math.max(ng, 1)];
  }
  const pct = (arr, f) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(f * arr.length))] : 0);

  // a, b: RGBA arrays of the same w x h image (ours, the painting); box: [x0, y0, x1, y1] in pixels.
  function measure(a, b, w, h, box) {
    const bx = clampBox(box, w, h), [x0, y0, x1, y1] = bx;
    const YA = lumaPlane(a, w, h), YB = lumaPlane(b, w, h);
    let dE = 0, n = 0, ca = 0, cb = 0;
    const LA = [], LB = [], labA = [0, 0, 0], labB = [0, 0, 0];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const p = y * w + x, o = p * 4;
      if (YA[p] > PAPER_L && YB[p] > PAPER_L) continue;
      const la = srgbToLab(a[o], a[o + 1], a[o + 2]), lb = srgbToLab(b[o], b[o + 1], b[o + 2]);
      dE += Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]); n++;
      ca += Math.hypot(la[1], la[2]); cb += Math.hypot(lb[1], lb[2]);
      for (let k = 0; k < 3; k++) { labA[k] += la[k]; labB[k] += lb[k]; }
      LA.push(la[0]); LB.push(lb[0]);
    }
    LA.sort((p, q) => p - q); LB.sort((p, q) => p - q);
    const s = ssim(YA, YB, w, bx), ta = texture(YA, w, bx), tb = texture(YB, w, bx);
    const contrast = ta[0] / Math.max(tb[0], 1e-3), edges = ta[1] / Math.max(tb[1], 1e-3);
    const tex = Math.exp(-2 * Math.abs(Math.log(Math.max(contrast, 1e-3)))) * Math.exp(-2 * Math.abs(Math.log(Math.max(edges, 1e-3))));
    const meanDE = n ? dE / n : 0, ssimN = Math.max(0, Math.min(1, (s - 0.1) / 0.6));
    const r1 = (v) => +v.toFixed(1), r3 = (v) => +v.toFixed(3);
    return {
      score: r1(100 * (0.4 * Math.exp(-meanDE / 12) + 0.3 * ssimN + 0.3 * tex)),
      dE: r1(meanDE), ssim: r3(s), contrast: r3(contrast), edges: r3(edges), texture: r3(tex),
      lab: { ours: labA.map((v) => r1(v / Math.max(n, 1))), ref: labB.map((v) => r1(v / Math.max(n, 1))) },
      L: { ours: [0.05, 0.5, 0.95].map((f) => r1(pct(LA, f))), ref: [0.05, 0.5, 0.95].map((f) => r1(pct(LB, f))) },
      chroma: { ours: r1(ca / Math.max(n, 1)), ref: r1(cb / Math.max(n, 1)) },
      pixels: n,
    };
  }

  const api = { srgbToLab, measure, ssim, texture };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else (root.CharacterLab = root.CharacterLab || {}).wcRegionMath = api;
})(typeof window !== "undefined" ? window : globalThis);

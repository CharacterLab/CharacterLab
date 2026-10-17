// Display-size accuracy for the Character Lab. The lab's score compares at the painting's own pixels,
// so anything thinner than one of them averages away and never counts.
// These metrics compare at the size the lab shows: our render drawn at that size beside the
// painting enlarged the same way.
//   ssim    structural similarity of luminance, 8x8 windows every 4 px (1 = identical)
//   edges   our gradient energy / the painting's, inside the figure (1 = same amount of edges)
//   detail  |our fine detail - the painting's| / the painting's fine detail (0 = same detail)
//   excess  fine detail we have that the painting has not, same scale (0 = nothing extra)
//   gmsd    gradient magnitude similarity deviation (Xue et al. 2014), a perceptual quality index:
//           how unevenly our edges agree with the painting's (0 = identical, ~0.1 good, 0.2+ visibly off)
//   chroma  our fine colour variation / the painting's (1 = same; rainbow fringes and colour speckle
//           push it up, while fur and grain are mostly light and dark, so they do not)
// fine detail = a channel minus a 5x5 box blur of itself.
(function () {
  const CharacterLab = (window.CharacterLab = window.CharacterLab || {});

  function luma(ctx, w, h) {
    const d = ctx.getImageData(0, 0, w, h).data, N = w * h;
    const Y = new Float32Array(N), Cb = new Float32Array(N), Cr = new Float32Array(N), ink = new Uint8Array(N);
    for (let i = 0, p = 0; p < N; i += 4, p++) {
      const r = d[i], g = d[i + 1], b = d[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      Y[p] = 0.299 * r + 0.587 * g + 0.114 * b;
      Cb[p] = -0.1687 * r - 0.3313 * g + 0.5 * b; Cr[p] = 0.5 * r - 0.4187 * g - 0.0813 * b;
      ink[p] = Y[p] < 236 || (mx - mn) / Math.max(mx, 1) > 0.1 ? 1 : 0;
    }
    return { Y, Cb, Cr, ink };
  }
  // GMSD on Prewitt gradients, over pixels inside either figure.
  function gmsd(A, B, inkA, inkB, w, h) {
    const c = 170, g = (Y, o) => { const gx = (Y[o - w + 1] + Y[o + 1] + Y[o + w + 1] - Y[o - w - 1] - Y[o - 1] - Y[o + w - 1]) / 3, gy = (Y[o + w - 1] + Y[o + w] + Y[o + w + 1] - Y[o - w - 1] - Y[o - w] - Y[o - w + 1]) / 3; return Math.hypot(gx, gy); };
    let s = 0, s2 = 0, n = 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const o = y * w + x;
      if (!inkA[o] && !inkB[o]) continue;
      const a = g(A, o), b = g(B, o), q = (2 * a * b + c) / (a * a + b * b + c);
      s += q; s2 += q * q; n++;
    }
    const m = s / Math.max(n, 1);
    return Math.sqrt(Math.max(0, s2 / Math.max(n, 1) - m * m));
  }
  function boxBlur(Y, w, h, r) {
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h), n = 2 * r + 1;
    for (let y = 0; y < h; y++) {
      let s = 0;
      for (let x = -r; x <= r; x++) s += Y[y * w + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = s / n;
        s += Y[y * w + Math.min(w - 1, x + r + 1)] - Y[y * w + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = s / n;
        s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
    return out;
  }
  function ssim(A, B, w, h) {
    const C1 = 6.5025, C2 = 58.5225, win = 8, N = win * win;
    let s = 0, n = 0;
    for (let y = 0; y + win <= h; y += 4) for (let x = 0; x + win <= w; x += 4) {
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

  // ours, ref: canvases of the same size (ours rendered at that size, ref enlarged with smoothing).
  function measure(ours, ref) {
    const w = ref.width, h = ref.height;
    const A = luma(ours.getContext("2d", { willReadFrequently: true }), w, h);
    const B = luma(ref.getContext("2d", { willReadFrequently: true }), w, h);
    const fa = boxBlur(A.Y, w, h, 2), fb = boxBlur(B.Y, w, h, 2);
    const cba = boxBlur(A.Cb, w, h, 2), cra = boxBlur(A.Cr, w, h, 2), cbb = boxBlur(B.Cb, w, h, 2), crb = boxBlur(B.Cr, w, h, 2);
    let ge = 0, gr = 0, dd = 0, ex = 0, fr = 0, n = 0, ca = 0, cb = 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const o = y * w + x;
      if (!A.ink[o] && !B.ink[o]) continue;
      ge += Math.abs(A.Y[o + 1] - A.Y[o - 1]) + Math.abs(A.Y[o + w] - A.Y[o - w]);
      gr += Math.abs(B.Y[o + 1] - B.Y[o - 1]) + Math.abs(B.Y[o + w] - B.Y[o - w]);
      const ha = A.Y[o] - fa[o], hb = B.Y[o] - fb[o];
      dd += Math.abs(ha - hb); ex += Math.max(0, Math.abs(ha) - Math.abs(hb)); fr += Math.abs(hb); n++;
      ca += Math.hypot(A.Cb[o] - cba[o], A.Cr[o] - cra[o]); cb += Math.hypot(B.Cb[o] - cbb[o], B.Cr[o] - crb[o]);
    }
    return { ssim: +ssim(A.Y, B.Y, w, h).toFixed(4), edges: +(ge / Math.max(gr, 1e-6)).toFixed(3),
      detail: +(dd / Math.max(fr, 1e-6)).toFixed(3), excess: +(ex / Math.max(fr, 1e-6)).toFixed(3),
      gmsd: +gmsd(A.Y, B.Y, A.ink, B.ink, w, h).toFixed(4), chroma: +(ca / Math.max(cb, 1e-6)).toFixed(3), size: [w, h] };
  }

  CharacterLab.wcDisplayScore = { measure };
})();

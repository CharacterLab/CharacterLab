// The figure's box on a reference sheet, found from its pixels: the bounding box of every pixel that differs from the
// sheet's background colour (the colour most of its corners share) by more than a threshold, plus a small margin,
// clamped to the sheet. Shared by the server's pack maker (lab/scripts/pack-maker.mjs) and the new-character page
// (lab/new.html), so the box the page shows is the box the pack gets.
//   findBox(rgba, width, height, { threshold, margin }) -> [x, y, w, h]
// rgba: width × height × 4 bytes (a Uint8Array, Uint8ClampedArray or Buffer), row by row. A sheet with nothing on it
// gives the whole sheet.
export const BOX_THRESHOLD = 28;   // per channel, 0–255: JPEG noise and paper grain stay below it, a figure does not

const pixel = (rgba, width, x, y) => { const i = (y * width + x) * 4; return [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]]; };
const distance = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]), Math.abs(a[3] - b[3]));

// The background: the corner colour that most other corners agree with (ties: the top-left corner).
export function backgroundOf(rgba, width, height, threshold = BOX_THRESHOLD) {
  const corners = [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]].map(([x, y]) => pixel(rgba, width, x, y));
  const votes = corners.map((c) => corners.filter((d) => distance(c, d) <= threshold).length);
  return corners[votes.indexOf(Math.max(...votes))];
}

export function findBox(rgba, width, height, { threshold = BOX_THRESHOLD, margin = null } = {}) {
  if (!(width > 0 && height > 0) || !rgba || rgba.length < width * height * 4) throw new Error('findBox needs width × height RGBA pixels');
  const bg = backgroundOf(rgba, width, height, threshold);
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    let i = y * width * 4;
    for (let x = 0; x < width; x++, i += 4) {
      // a transparent pixel is background whatever its colour channels hold
      const a = rgba[i + 3];
      const differs = bg[3] < 8 ? a > threshold
        : Math.abs(rgba[i] - bg[0]) > threshold || Math.abs(rgba[i + 1] - bg[1]) > threshold || Math.abs(rgba[i + 2] - bg[2]) > threshold || Math.abs(a - bg[3]) > threshold;
      if (!differs) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return [0, 0, width, height];
  const m = margin ?? Math.max(4, Math.round(Math.max(width, height) * 0.015));
  const left = Math.max(0, x0 - m), top = Math.max(0, y0 - m);
  const right = Math.min(width, x1 + 1 + m), bottom = Math.min(height, y1 + 1 + m);
  return [left, top, right - left, bottom - top];
}

// A box [x, y, w, h] of whole pixels, at least 8 × 8, inside a width × height sheet; or null.
export function checkBox(box, width, height) {
  if (!Array.isArray(box) || box.length !== 4 || !box.every((n) => Number.isInteger(n) && n >= 0)) return null;
  const [x, y, w, h] = box;
  return w >= 8 && h >= 8 && x + w <= width && y + h <= height ? [x, y, w, h] : null;
}

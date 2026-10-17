#!/usr/bin/env python3
"""Trace Captain Kite's reference sheets into flat cel shapes (the pack's kite-shapes.js).

How the shapes were measured, so the data can be checked and redone:
  1. every pixel of a figure's box is sorted into a colour group by its hue, saturation and value (teal suit,
     orange, yellow, skin, white, denim, box, dark masses = hair / bag / glasses) or is line ink or background;
  2. dark pixels that survive an opening (radius 2) are dark masses (hair), the rest are the drawing's lines;
  3. each group's 4-connected regions (lines removed) grow back over the line ink they touch (the line's width), their
     holes are filled (a hole that is mostly background is kept out), and their outline is traced along the pixel edges
     and simplified (Douglas-Peucker, TOL px);
  4. a region's two tones (flat and cel shadow) give its colours, and the cel shadow's reach and light angle are the
     ones whose offset outline best covers the painted shadow (the renderer's cel shadow is that offset outline);
  5. inside a face box nothing but skin, mask and hair is traced (the eyes, brows, nose and mouth are drawn by code),
     and the eye openings, irises, brows and mouth found there are written out as measurements.

Needs Python 3 with numpy, scipy and Pillow. Run from this folder:  python3 trace-sheets.py  (writes ../kite-shapes.js)
"""
import json
import math
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
SHEETS = os.path.join(HERE, '..', 'sheets')
OUT = os.path.join(HERE, '..', 'kite-shapes.js')
TOL = 1.4            # px, outline simplification
MIN_AREA = 30        # px, smaller regions are dropped
MIN_AREA_OF = {'pose-lookup': 8}   # the looking-up face is not drawn by code: its small marks are traced
SHADOW_FIT = 0.88    # a region whose painted shadow its offset outline matches less well gets its shadow's own shapes
LIGHTS = [-math.pi * k / 8 for k in range(2, 9)]   # candidate light directions: from above (-pi/2) round to the left (-pi)

# figure id: sheet, box (x0, y0, x1, y1), face box (or None), part boxes for the rig [(part, x0, y0, x1, y1), ...]
# (a region goes to the first part box holding its centre; otherwise 'body')
FIGURES = {
    'front': ('01-identity.png', (280, 6, 732, 1000), (440, 70, 566, 200), [
        ('head', 410, 0, 600, 205), ('armR', 280, 215, 425, 620), ('armL', 590, 215, 732, 620)]),
    'turn-front': ('02-turnaround.png', (0, 112, 292, 884), (100, 175, 200, 262), [('head', 70, 112, 230, 268)]),
    'turn-3q': ('02-turnaround.png', (290, 112, 541, 884), (380, 178, 476, 262), [('head', 350, 112, 500, 268)]),
    'turn-side': ('02-turnaround.png', (539, 112, 714, 884), (630, 180, 696, 262), [('head', 570, 112, 714, 268)]),
    'turn-back': ('02-turnaround.png', (734, 112, 1024, 884), None, [('head', 820, 112, 950, 270)]),
    'expr-neutral': ('03-expressions.png', (12, 34, 346, 506), (105, 140, 270, 300), [('head', 60, 34, 300, 312)]),
    'expr-happy': ('03-expressions.png', (350, 34, 672, 506), (425, 140, 595, 300), [('head', 380, 34, 640, 312)]),
    'expr-surprised': ('03-expressions.png', (677, 34, 1012, 506), (755, 140, 925, 300), [('head', 710, 34, 970, 312)]),
    'expr-determined': ('03-expressions.png', (12, 518, 346, 992), (105, 625, 270, 785), [('head', 60, 518, 300, 795)]),
    'expr-sad': ('03-expressions.png', (350, 516, 672, 992), (425, 625, 595, 785), [('head', 380, 516, 640, 795)]),
    'expr-laughing': ('03-expressions.png', (677, 519, 1012, 992), (755, 625, 925, 785), [('head', 710, 519, 970, 795)]),
    'pose-walk': ('04-poses.png', (148, 46, 468, 514), (305, 85, 355, 140), [('head', 270, 46, 365, 150)]),
    'pose-wave': ('04-poses.png', (606, 47, 841, 516), (700, 85, 765, 140), [
        ('head', 685, 47, 770, 150), ('hand', 606, 47, 672, 200)]),
    'pose-sit': ('04-poses.png', (148, 524, 468, 964), (290, 570, 352, 630), [('head', 270, 524, 370, 640)]),
    'pose-lookup': ('04-poses.png', (615, 515, 841, 963), None, [('head', 680, 515, 775, 600)]),
    'civilian': ('05-civilian.png', (284, 6, 729, 1000), (445, 70, 566, 200), [
        ('head', 410, 0, 600, 205), ('armR', 284, 215, 420, 620), ('armL', 595, 215, 729, 620)]),
    'landing': ('06-hero-poses.png', (30, 274, 485, 776), (265, 360, 360, 430), [('head', 235, 280, 385, 450)]),
    'flying': ('06-hero-poses.png', (511, 396, 1008, 573), (840, 435, 905, 490), [('head', 815, 396, 925, 505)]),
}

GROUPS = ['bg', 'line', 'dark', 'teal', 'orange', 'yellow', 'skin', 'white', 'denim', 'box', 'other']
G = {g: i for i, g in enumerate(GROUPS)}
# drawing order of the groups (a region's own order inside a group: biggest first); holes are filled, so a region
# that contains another must come first: the order only matters where shapes overlap on the shared line
ORDER = ['box', 'orange', 'teal', 'denim', 'white', 'skin', 'yellow', 'dark', 'other']
FACE_KEEP = {G['skin'], G['orange'], G['dark']}


def hsv(im):
    f = im.astype(float) / 255
    mx, mn = f.max(2), f.min(2)
    d = mx - mn
    s = np.where(mx > 0, d / np.maximum(mx, 1e-6), 0)
    r, g, b = f[..., 0], f[..., 1], f[..., 2]
    h = np.zeros_like(mx)
    m = d > 1e-6
    rm = m & (mx == r)
    gm = m & (mx == g) & ~rm
    bm = m & ~rm & ~gm
    h[rm] = ((g - b)[rm] / d[rm]) % 6
    h[gm] = (b - r)[gm] / d[gm] + 2
    h[bm] = (r - g)[bm] / d[bm] + 4
    return h * 60, s, mx * 255


def classify(im, bg):
    H, S, V = hsv(im)
    cls = np.full(im.shape[:2], G['other'], np.int8)
    dbg = np.abs(im - bg[None, None, :]).max(2)
    dwh = np.abs(im - 248).max(2)
    grey = S < 0.2
    cls[grey & (V >= 140)] = G['white']
    cls[grey & (dbg <= 6) & (dbg < dwh)] = G['bg']
    sat = (S >= 0.2) & (V >= 70)
    cls[sat & (H >= 150) & (H < 205) & (S > 0.5)] = G['teal']
    cls[sat & (H >= 205) & (H < 240) & (S > 0.4)] = G['denim']
    cls[sat & (H >= 190) & (H < 240) & (S <= 0.4) & (V > 120)] = G['box']
    cls[sat & (H >= 38) & (H < 65) & (S > 0.45)] = G['yellow']
    warm = sat & ((H < 38) | (H >= 345))
    cls[warm & (S > 0.68)] = G['orange']
    cls[warm & (S <= 0.68) & (V > 120)] = G['skin']
    cls[V < 70] = G['line']
    # background is what reaches the box's border; a background-coloured patch inside the figure is a white's light
    lab, n = ndi.label(cls == G['bg'])
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    white0 = cls == G['white']
    for k in range(1, n + 1):
        if k in edge:
            continue
        patch = lab == k
        ys, xs = np.nonzero(patch)
        win = (slice(max(ys.min() - 3, 0), ys.max() + 4), slice(max(xs.min() - 3, 0), xs.max() + 4))
        p = patch[win]
        ring = ndi.binary_dilation(p, iterations=2) & ~p
        if white0[win][ring].mean() > 0.3:
            cls[win][p] = G['white']
    # the sheets' sharpening leaves a one-pixel light fringe outside the ink: thin white is background
    white = cls == G['white']
    thin = white & ~ndi.binary_opening(white, structure=np.ones((3, 3), bool))
    cls[thin & ndi.binary_dilation(cls == G['bg'], iterations=2)] = G['bg']
    return cls, V


def crack_loops(mask):
    """Outline loops of a binary mask along pixel edges (inside on the right, y down), as vertex lists."""
    m = np.pad(mask, 1).astype(bool)
    h, w = m.shape
    nxt = {}
    ys, xs = np.nonzero(m)
    for y, x in zip(ys, xs):
        # vertices in padded coords; edge directions keep the inside on the right (clockwise on screen)
        if not m[y - 1, x]:
            nxt.setdefault((x, y), []).append((x + 1, y))
        if not m[y, x + 1]:
            nxt.setdefault((x + 1, y), []).append((x + 1, y + 1))
        if not m[y + 1, x]:
            nxt.setdefault((x + 1, y + 1), []).append((x, y + 1))
        if not m[y, x - 1]:
            nxt.setdefault((x, y + 1), []).append((x, y))
    loops = []
    while nxt:
        start = next(iter(nxt))
        loop, cur, prev_dir = [start], start, None
        while True:
            outs = nxt.get(cur)
            if not outs:
                break
            if len(outs) > 1 and prev_dir is not None:
                # a saddle: turn right (keeps diagonal neighbours apart)
                right = (-prev_dir[1], prev_dir[0])
                pick = next((o for o in outs if (o[0] - cur[0], o[1] - cur[1]) == right), outs[0])
            else:
                pick = outs[0]
            outs.remove(pick)
            if not outs:
                del nxt[cur]
            prev_dir = (pick[0] - cur[0], pick[1] - cur[1])
            cur = pick
            if cur == start:
                break
            loop.append(cur)
        loops.append([(x - 1, y - 1) for x, y in loop])
    return loops


def area(poly):
    a = 0.0
    for i in range(len(poly)):
        x0, y0 = poly[i - 1]
        x1, y1 = poly[i]
        a += x0 * y1 - x1 * y0
    return a / 2


def rdp(pts, tol):
    pts = np.asarray(pts, float)
    if len(pts) < 4:
        return pts.tolist()
    keep = np.zeros(len(pts), bool)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        p, q = pts[a], pts[b]
        seg = pts[a + 1:b]
        d = q - p
        n = math.hypot(*d)
        if n < 1e-9:
            dist = np.hypot(*(seg - p).T)
        else:
            dist = np.abs(d[0] * (seg[:, 1] - p[1]) - d[1] * (seg[:, 0] - p[0])) / n
        i = int(np.argmax(dist))
        if dist[i] > tol:
            keep[a + 1 + i] = True
            stack += [(a, a + 1 + i), (a + 1 + i, b)]
    return pts[keep].tolist()


def simplify_closed(loop, tol):
    # split the loop at its two farthest-apart vertices, simplify each half
    pts = np.asarray(loop, float)
    i = 0
    j = int(np.argmax(np.hypot(*(pts - pts[0]).T)))
    a = rdp(np.vstack([pts[i:j + 1]]), tol)
    b = rdp(np.vstack([pts[j:], pts[:1]]), tol)
    return a[:-1] + b[:-1]


def shift(mask, dx, dy):
    """mask moved by (dx, dy) whole pixels (out of range is False)."""
    out = np.zeros_like(mask)
    h, w = mask.shape
    dx, dy = int(round(dx)), int(round(dy))
    xs0, xs1 = max(0, -dx), min(w, w - dx)
    ys0, ys1 = max(0, -dy), min(h, h - dy)
    if xs1 > xs0 and ys1 > ys0:
        out[ys0 + dy:ys1 + dy, xs0 + dx:xs1 + dx] = mask[ys0:ys1, xs0:xs1]
    return out


def fit_shadow(shape, base, shade):
    """Light angle and reach whose cel shadow (shape not covering p moved away from the light) best matches."""
    region = base | shade
    n = region.sum()
    if n == 0 or shade.sum() < 0.02 * n:
        return 0.0, LIGHTS[2], 1 - shade.sum() / max(n, 1)
    best = (0.0, LIGHTS[2], 1 - shade.sum() / n)
    for la in LIGHTS:
        cx, cy = math.cos(la), math.sin(la)
        for s in range(1, 41):
            pred = region & ~shift(shape, -cx * s, -cy * s)
            acc = 1 - (pred ^ shade)[region].sum() / n
            if acc > best[2]:
                best = (float(s), la, acc)
    return best


def hexc(c):
    return '#%02x%02x%02x' % tuple(int(round(v)) for v in c)


def two_tones(pix, V):
    """flat and shadow colour of a region: split its pixels by value at the largest gap between two means."""
    if len(pix) < 4:
        c = np.median(pix, 0)
        return c, c, np.ones(len(pix), bool)
    lo, hi = np.percentile(V, 10), np.percentile(V, 90)
    t = (lo + hi) / 2
    for _ in range(10):
        a, b = V[V < t], V[V >= t]
        if len(a) == 0 or len(b) == 0:
            break
        t = (a.mean() + b.mean()) / 2
    light = V >= t
    if hi - lo < 18 or light.sum() == 0 or (~light).sum() == 0:
        c = np.median(pix, 0)
        return c, c, np.ones(len(pix), bool)
    return np.median(pix[light], 0), np.median(pix[~light], 0), light


def comps_of(mask, min_n):
    lab, n = ndi.label(mask)
    out = []
    for i in range(1, n + 1):
        ys, xs = np.nonzero(lab == i)
        if len(xs) >= min_n:
            out.append((xs, ys))
    return out


def measure_face(cls, im, V, fb, ox, oy, mask_filled):
    """Eye openings (inside the mask's holes) and irises, brows (dark marks above the eyes), the mouth (marks below)."""
    x0, y0, x1, y1 = fb
    sub = (slice(y0 - oy, y1 - oy), slice(x0 - ox, x1 - ox))
    c, sv = cls[sub], V[sub]
    res = {'eyes': []}
    if mask_filled is not None:
        openings = mask_filled[sub] & (c != G['orange'])
        cs = sorted(comps_of(openings, 12), key=lambda t: -len(t[0]))[:2]
        for xs, ys in cs:
            e = {'c': [round(float(xs.mean()) + x0, 1), round(float(ys.mean()) + y0, 1)],
                 'box': [int(xs.min() + x0), int(ys.min() + y0), int(xs.max() + x0 + 1), int(ys.max() + y0 + 1)], 'n': len(xs)}
            o = np.zeros_like(openings)
            o[ys, xs] = True
            iris = o & (sv >= 60) & (sv < 175) & np.isin(c, [G['orange'], G['skin'], G['other']])
            iy, ix = np.nonzero(iris)
            if len(ix):
                e['iris'] = [round(float(np.median(ix)) + x0, 1), round(float(np.median(iy)) + y0, 1)]
                e['irisR'] = round(float(np.percentile(ix, 95) - np.percentile(ix, 5)) / 2 + 1, 1)
            res['eyes'].append(e)
        res['eyes'].sort(key=lambda e: e['c'][0])
    eyes = res['eyes']
    if len(eyes) < 2:
        return res
    (l, r) = eyes[0], eyes[1]
    span = r['c'][0] - l['c'][0]
    eh = max(e['box'][3] - e['box'][1] for e in eyes)
    top = min(e['box'][1] for e in eyes)
    bot = max(e['box'][3] for e in eyes)
    ink = np.isin(c, [G['line'], G['dark']])
    yy = np.arange(c.shape[0])[:, None] + y0
    xx = np.arange(c.shape[1])[None, :] + x0
    # brows: ink in a band above each eye (the hair above the band is cut off)
    brows = []
    for e in eyes:
        bw = (e['box'][2] - e['box'][0])
        band = ink & (yy >= e['box'][1] - 0.95 * eh) & (yy < e['box'][1] - 0.05 * eh) & (xx >= e['box'][0] - 0.2 * bw) & (xx < e['box'][2] + 0.2 * bw)
        if mask_filled is not None:
            band &= ~(mask_filled[sub] & (c != G['orange']))
        cs = comps_of(band, 6)
        if not cs:
            continue
        xs, ys = max(cs, key=lambda t: len(t[0]))
        w = xs.max() - xs.min() + 1
        pts = []
        for q in np.linspace(xs.min(), xs.max(), 5):
            sel = np.abs(xs - q) <= max(1, w / 10)
            pts.append([round(float(q) + x0, 1), round(float(ys[sel].mean()) + y0, 1), round(float(ys[sel].max() - ys[sel].min() + 1), 1)])
        brows.append({'pts': pts, 'n': len(xs)})
    res['brows'] = brows
    # the mouth: marks that are not skin between the eyes' centres, from below the nose down to the face box
    mid = (l['c'][0] + r['c'][0]) / 2
    win = (yy > bot + 0.2 * span) & (yy < bot + 0.95 * span) & (np.abs(xx - mid) < 0.75 * span)
    lower = win & (((c != G['skin']) & (c != G['bg'])) | (sv < 165))
    marks = comps_of(lower, 3)
    if marks:
        marks.sort(key=lambda t: -len(t[0]))
        xs, ys = marks[0]
        mx0, mx1, my0, my1 = xs.min(), xs.max(), ys.min(), ys.max()
        for xs2, ys2 in marks[1:]:
            if ys2.min() <= my1 + 3 and ys2.max() >= my0 - 3 and xs2.min() <= mx1 + 5 and xs2.max() >= mx0 - 5:
                mx0, mx1, my0, my1 = min(mx0, xs2.min()), max(mx1, xs2.max()), min(my0, ys2.min()), max(my1, ys2.max())
        res['mouth'] = {'box': [int(mx0 + x0), int(my0 + y0), int(mx1 + x0 + 1), int(my1 + y0 + 1)]}
    return res


def thin(mask):
    """Zhang-Suen thinning: the one-pixel centre lines of a binary mask."""
    m = np.pad(mask.astype(np.uint8), 1)
    while True:
        changed = False
        for step in (0, 1):
            P = [np.roll(np.roll(m, -dy, 0), -dx, 1) for dy, dx in ((-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1), (0, -1), (-1, -1))]
            B = sum(P)
            A = sum(((P[i] == 0) & (P[(i + 1) % 8] == 1)).astype(int) for i in range(8))
            if step == 0:
                c = (P[0] * P[2] * P[4] == 0) & (P[2] * P[4] * P[6] == 0)
            else:
                c = (P[0] * P[2] * P[6] == 0) & (P[0] * P[4] * P[6] == 0)
            rm = (m == 1) & (B >= 2) & (B <= 6) & (A == 1) & c
            if rm.any():
                m[rm] = 0
                changed = True
        if not changed:
            break
    return m[1:-1, 1:-1].astype(bool)


def skeleton_paths(sk):
    """The skeleton's pixels walked into polylines (from ends and junctions; loops broken anywhere)."""
    ys, xs = np.nonzero(sk)
    pix = set(zip(ys.tolist(), xs.tolist()))
    nb = lambda p: [(p[0] + dy, p[1] + dx) for dy in (-1, 0, 1) for dx in (-1, 0, 1) if (dy or dx) and (p[0] + dy, p[1] + dx) in pix]
    deg = {p: len(nb(p)) for p in pix}
    used, paths = set(), []
    starts = [p for p in pix if deg[p] != 2] + list(pix)
    for s0 in starts:
        for n0 in nb(s0):
            if (s0, n0) in used or (n0, s0) in used:
                continue
            path, prev, cur = [s0], s0, n0
            used.add((s0, n0))
            while True:
                path.append(cur)
                if deg[cur] != 2 or cur == s0:
                    break
                nxt = [q for q in nb(cur) if q != prev and (cur, q) not in used and (q, cur) not in used]
                if not nxt:
                    break
                used.add((cur, nxt[0]))
                prev, cur = cur, nxt[0]
            paths.append(path)
    return paths


def interior_lines(line, region_id, fm, parts, x0, y0, min_len=7):
    """The drawing's lines inside one region (folds, muscles, the pocket): not on a region's edge, outside the face."""
    big = np.where(region_id > 0, region_id, 1 << 30)
    lo = ndi.minimum_filter(big, size=7)
    hi = ndi.maximum_filter(region_id, size=7)
    inner = line & (lo == hi) & (hi > 0) & ~fm
    sk = thin(inner)
    out = []
    for path in skeleton_paths(sk):
        if len(path) < min_len:
            continue
        pts = rdp([[x, y] for y, x in path], 1.0)
        width = 1.0
        cy, cx = np.mean([p[0] for p in path]), np.mean([p[1] for p in path])
        part = 'body'
        for (pn, px0, py0, px1, py1) in parts:
            if px0 <= cx + x0 < px1 and py0 <= cy + y0 < py1:
                part = pn
                break
        out.append({'part': part, 'pts': [[int(round(px + x0)), int(round(py + y0))] for px, py in pts]})
    # the line's width: the inner line pixels per pixel of skeleton
    w = float(inner.sum()) / max(int(sk.sum()), 1)
    for o in out:
        o['w'] = round(min(max(w, 1.0), 3.0), 2)
    return out


def feature_zone(fid, cls, fm, x0, y0, margin=0.5):
    """The part of the face box the face's code draws: from above the brows to below the mouth, eye to eye."""
    man = FACE_MANUAL.get(fid, {})
    eyes = [e['box'] for e in man.get('eyes', [])]
    if not eyes:
        lab, n = ndi.label(cls == G['orange'])
        best = None
        for i in range(1, n + 1):
            c = lab == i
            if c.sum() > 200 and fm[c].mean() > 0.8 and (best is None or c.sum() > best.sum()):
                best = c
        if best is not None:
            openings = ndi.binary_fill_holes(best) & ~best
            for xs, ys in sorted(comps_of(openings, 12), key=lambda t: -len(t[0]))[:2]:
                eyes.append([xs.min() + x0, ys.min() + y0, xs.max() + x0 + 1, ys.max() + y0 + 1])
    if not eyes:
        return fm
    w = np.mean([b[2] - b[0] for b in eyes])
    h = np.mean([b[3] - b[1] for b in eyes])
    top = min(b[1] for b in eyes) - 1.4 * h
    m = man.get('mouth', {})
    if 'bottom' in m:
        bot = m['bottom'] + 3
    elif 'c' in m:
        bot = m['c'][1] + m['o'] * 1.2 + 3
    elif 'l' in m:
        bot = max(m['l'][1], m['r'][1], m.get('m', m['l'])[1]) + 0.3 * w
    else:
        bot = max(b[3] for b in eyes) + 2.5 * h
    zone = np.zeros_like(fm)
    zx0, zx1 = int(min(b[0] for b in eyes) - margin * w - x0), int(max(b[2] for b in eyes) + margin * w - x0)
    zone[max(int(top - y0), 0):max(int(bot - y0), 0), max(zx0, 0):max(zx1, 0)] = True
    return fm & zone


def trace_figure(fid, sheet, box, face, parts, cache):
    if sheet not in cache:
        im = np.array(Image.open(os.path.join(SHEETS, sheet)).convert('RGB')).astype(int)
        bg = np.median(np.vstack([im[:8, :8].reshape(-1, 3), im[-8:, -8:].reshape(-1, 3)]), 0)
        cache[sheet] = (im, bg)
    im, bg = cache[sheet]
    x0, y0, x1, y1 = box
    sub = im[y0:y1, x0:x1]
    cls, V = classify(sub, bg)
    dark = cls == G['line']
    mass = ndi.binary_opening(dark, structure=np.ones((5, 5), bool))
    mass = ndi.binary_dilation(mass, iterations=1) & dark
    cls[mass] = G['dark']
    line = cls == G['line']
    # the ink colour and the line's width (median thickness of thin dark runs)
    line_col = np.median(sub[line], 0) if line.any() else np.array([30, 25, 30])
    runs = []
    for row in line[::7]:
        r = np.diff(np.concatenate([[0], row.astype(int), [0]]))
        s, e = np.nonzero(r == 1)[0], np.nonzero(r == -1)[0]
        runs += [b - a for a, b in zip(s, e) if b - a <= 8]
    lw = float(np.median(runs)) if runs else 2.5
    grow = int(math.ceil(lw)) + 1
    claimable = line | (cls == G['other'])
    if face:
        fx0, fy0, fx1, fy1 = face[0] - x0, face[1] - y0, face[2] - x0, face[3] - y0
        fm = np.zeros_like(line)
        fm[max(fy0, 0):fy1, max(fx0, 0):fx1] = True
        fbox = fm
        fm_lines = feature_zone(fid, cls, fm, x0, y0, margin=0.0)   # the jaw's lines stay traced
        fm = feature_zone(fid, cls, fm, x0, y0)
        # in the face, everything but skin, mask and hair is the face's own drawing: it may be covered
        claimable = claimable | (fm & ~np.isin(cls, list(FACE_KEEP)) & (cls != G['bg']))
    else:
        fm = np.zeros_like(line)
        fbox = fm_lines = fm
    near_line = ndi.binary_dilation(line | (cls == G['dark']), iterations=2)
    region_id = np.zeros(cls.shape, np.int32)
    shapes, mask_filled = [], None
    palette = {}
    for g in ORDER:
        gi = G[g]
        gm = cls == gi
        lab, n = ndi.label(gm)
        for i in range(1, n + 1):
            comp = lab == i
            cnt = int(comp.sum())
            if cnt < MIN_AREA_OF.get(fid, MIN_AREA):
                continue
            ys, xs = np.nonzero(comp)
            if face and g != 'skin' and fm[ys, xs].all() and cnt < 0.045 * fm.sum():
                continue          # an eye, a brow, the mouth: the face draws them
            region_id[comp] = len(shapes) + 1
            grown = comp.copy()
            # the skin runs on under the mask, so its outline there is hidden (the mask has no ink line)
            claim = claimable | (fbox & (cls == G['orange'])) if (face and g == 'skin') else claimable
            for _ in range(grow):
                grown = grown | (ndi.binary_dilation(grown) & claim)
            filled = ndi.binary_fill_holes(grown)
            holes = filled & ~grown
            # holes that are mostly background stay holes (a gap between an arm and the body)
            hl, hn = ndi.label(holes)
            bg_holes = []
            for k in range(1, hn + 1):
                hk = hl == k
                if (cls[hk] == G['bg']).mean() > 0.5 and hk.sum() >= MIN_AREA:
                    filled = filled & ~hk
                    bg_holes.append(hk)
            loops = crack_loops(filled)
            if not loops:
                continue
            loop = max(loops, key=lambda L: abs(area(L)))
            poly = simplify_closed(loop, TOL)
            if len(poly) < 3:
                continue
            pix = sub[comp]
            base, shade, light = two_tones(pix, V[comp])
            base_m = np.zeros_like(comp)
            base_m[comp] = light
            shade_m = comp & ~base_m
            reach, la, acc = fit_shadow(filled, base_m, shade_m) if not np.allclose(base, shade) else (0.0, LIGHTS[2], 1.0)
            cx, cy = float(xs.mean() + x0), float(ys.mean() + y0)
            part = 'body'
            for (pn, px0, py0, px1, py1) in parts:
                if px0 <= cx < px1 and py0 <= cy < py1:
                    part = pn
                    break
            # how much of its edge the sheet inks: a region whose edge is mostly its own colour (the mask on the skin)
            # gets no outline
            cf = ndi.binary_fill_holes(comp)
            edge = cf & ~ndi.binary_erosion(cf)
            ink = round(float(near_line[edge].mean()) if edge.any() else 0.0, 2)
            shp = {'g': g, 'part': part, 'ink': ink, 'pts': [[int(round(px + x0)), int(round(py + y0))] for px, py in poly],
                   'c': [hexc(base), hexc(shade)], 'sh': reach, 'la': round(la, 4), 'acc': round(float(acc), 3),
                   'n': cnt, 'filled': int(filled.sum()), 'cx': round(cx, 1), 'cy': round(cy, 1)}
            shp['key'] = float(filled.sum())
            shapes.append(shp)
            if face and g == 'orange' and fbox[ys, xs].mean() > 0.8:
                shp['sh'] = 0.0      # the mask: flat (its darker pixels are the eyes' lashes and the brows' edge)
            elif acc < SHADOW_FIT and shade_m.sum() >= MIN_AREA:
                # the offset outline misses the painted shadow: the shadow's own shapes, flat, over the region
                shp['sh'] = 0.0
                sl, sn = ndi.label(shade_m)
                for k in range(1, sn + 1):
                    sk = sl == k
                    if sk.sum() < MIN_AREA:
                        continue
                    for _ in range(grow):
                        sk = sk | (ndi.binary_dilation(sk) & claimable & filled)
                    sk = ndi.binary_fill_holes(sk)
                    sloops = crack_loops(sk)
                    if not sloops:
                        continue
                    sp = simplify_closed(max(sloops, key=lambda L: abs(area(L))), TOL)
                    if len(sp) >= 3:
                        shapes.append({'g': 'shade', 'part': part, 'ink': 0, 'pts': [[int(round(px + x0)), int(round(py + y0))] for px, py in sp],
                                       'c': [hexc(shade), hexc(shade)], 'sh': 0.0, 'la': 0, 'acc': 1, 'n': int(sk.sum()), 'filled': int(sk.sum()),
                                       'cx': 0, 'cy': 0, 'key': float(filled.sum()) - 0.25})
            for hk in bg_holes:
                hloops = crack_loops(hk)
                if hloops:
                    hp = simplify_closed(max(hloops, key=lambda L: abs(area(L))), TOL)
                    if len(hp) >= 3:
                        shapes.append({'g': 'hole', 'part': part, 'pts': [[int(round(px + x0)), int(round(py + y0))] for px, py in hp],
                                       'c': [hexc(bg), hexc(bg)], 'sh': 0.0, 'la': 0, 'acc': 1, 'n': int(hk.sum()), 'filled': int(hk.sum()),
                                       'ink': 1, 'cx': 0, 'cy': 0, 'key': float(filled.sum()) - 0.5})
            if face and g == 'orange' and mask_filled is None:
                # the domino mask: the orange region in the face box
                if fbox[ys, xs].mean() > 0.8:
                    mask_filled = filled
    lines = interior_lines(line, region_id, fm_lines, parts, x0, y0)
    # a region that holds another comes first (holes are filled): biggest first; a background hole right after its region
    shapes.sort(key=lambda t: -t['key'])
    for t in shapes:
        del t['key']
    res = {'id': fid, 'sheet': sheet, 'box': list(box), 'bg': hexc(bg), 'line': hexc(line_col), 'lineW': round(lw, 2),
           'shapes': shapes, 'lines': lines}
    if face:
        res['face'] = measure_face(cls, sub, V, face, x0, y0, mask_filled)
        res['faceBox'] = list(face)
    return res


# Face features measured by hand on gridded enlargements of the sheets (sheet pixels), where the automatic search above
# is unreliable: the mouth (corners l, r and its middle m, or the bottom of an open mouth, or an o's centre and
# radius), the nose's shadow, the brows (left to right: [[x, y, thickness], ...] each) and what the sheet paints
# there (the face params that reproduce it). eyes: openings measured by hand where the mask has none (or no mask).
FACE_MANUAL = {
    'front': {'mouth': {'l': [487, 165], 'm': [505, 167.6], 'r': [523, 163]}, 'nose': [504, 154],
              'brows': [[[472, 107.5, 5], [491, 109.5, 5]], [[511, 108, 5], [532, 106.5, 5]]]},
    'turn-front': {'mouth': {'l': [135.8, 242.3], 'm': [150.2, 244.5], 'r': [165, 241.8]}, 'nose': [150, 233.3],
                   'brows': [[[118.5, 198, 4.5], [138.7, 196, 4.5]], [[159.7, 196, 4.5], [180, 197.5, 4.5]]]},
    'turn-3q': {'mouth': {'l': [424.5, 241.4], 'm': [436.7, 243.4], 'r': [448.8, 241.4]}, 'nose': [443.4, 233],
                'brows': [[[396, 195, 3], [416.4, 193, 3]], [[451.5, 194.6, 3], [462, 197, 3]]]},
    'turn-side': {'eyesKeep': 1, 'mouth': {'l': [666.7, 240.7], 'm': [671, 242.6], 'r': [675.5, 242.4]},
                  'brows': [[[656, 193.5, 3], [672, 194.8, 3]]]},
    'expr-neutral': {'mouth': {'l': [164, 249], 'm': [190, 253], 'r': [217, 246]}, 'nose': [189, 233]},
    'expr-happy': {'mouth': {'l': [482, 247], 'r': [538, 244], 'bottom': 270}, 'nose': [509, 232], 'paint': {'mouth': 'happy'}},
    'expr-surprised': {'mouth': {'c': [840, 258], 'o': 12}, 'nose': [840, 232], 'paint': {'mouth': 'surprised', 'brows': 'raised', 'eyes': 'wide'}},
    'expr-determined': {'mouth': {'l': [168, 740], 'm': [189.5, 739], 'r': [211, 740]}, 'nose': [189.5, 721],
                        'paint': {'mouth': 'grim', 'brows': 'determined'}},
    'expr-sad': {'mouth': {'l': [491.5, 745], 'm': [508.7, 741], 'r': [525, 745]}, 'nose': [509, 722], 'paint': {'mouth': 'frown', 'brows': 'sad'}},
    'expr-laughing': {'mouth': {'l': [813.7, 728.4], 'r': [868.8, 724.5], 'bottom': 759}, 'nose': [840, 713],
                      'eyes': [{'c': [804.4, 684.4], 'box': [785, 670, 823, 701], 'iris': [802, 682], 'irisR': 16.8},
                               {'c': [873.3, 681.2], 'box': [855, 666, 893, 698], 'iris': [867.5, 678.5], 'irisR': 15.7}],
                      'paint': {'mouth': 'laugh', 'eyes': 'happy'}},
    'pose-walk': {'eyes': [{'c': [337.4, 109.7], 'box': [330, 104, 341, 116], 'iris': [337, 110.6], 'irisR': 3.5}],
                  'mouth': {'l': [335, 126.4], 'm': [340, 129], 'r': [345, 129.5]}, 'brows': [[[329.7, 96.2, 2.5], [342, 97.6, 2.5]]]},
    'pose-wave': {'mouth': {'l': [722.2, 125.3], 'r': [742.2, 124.3], 'bottom': 131.7}, 'nose': [731, 118.5],
                  'brows': [[[710, 97.5, 2.5], [717.8, 96, 2.5]], [[737.3, 95.6, 2.5], [749, 97, 2.5]]], 'paint': {'mouth': 'happy'}},
    'pose-sit': {'mouth': {'l': [311, 612.3], 'm': [319.8, 615.7], 'r': [331.5, 615.7]}, 'nose': [325.7, 608.5],
                 'brows': [[[299.4, 582, 2.5], [312, 581, 2.5]], [[336.4, 586, 2.5], [345, 587, 2.5]]]},
    'landing': {'mouth': {'l': [297, 420], 'm': [312, 422], 'r': [329, 419.6]}, 'nose': [313.6, 412],
                'brows': [[[279, 369, 4], [299, 372, 4]], [[321.4, 371.4, 4], [342.9, 368.6, 4]]]},
    'flying': {'eyesKeep': 2, 'mouth': {'l': [872.3, 479], 'r': [891, 484.6], 'bottom': 492.7}, 'brows': [], 'paint': {'mouth': 'happy'}},
    'civilian': {'eyes': [{'c': [478, 131], 'box': [462, 122.5, 491, 140.6], 'iris': [478, 131.5], 'irisR': 9.5},
                          {'c': [525.5, 129.6], 'box': [514, 120, 540, 138], 'iris': [525.5, 130], 'irisR': 9.5}],
                 'mouth': {'l': [487.7, 166.5], 'm': [505, 168.6], 'r': [523, 163.7]}, 'nose': [505, 154],
                 'brows': [[[464, 113, 3.5], [491, 111.5, 3.5]], [[513, 110.7, 3.5], [539.6, 112.6, 3.5]]],
                 'glasses': [[476.7, 134, 17.7], [525.5, 131, 17.5]], 'paint': {'glasses': True}},
}


def face_of(fid, auto):
    """The face record a figure is drawn with: the automatic eyes and brows, overridden by the hand measurements."""
    man = FACE_MANUAL.get(fid, {})
    f = {'eyes': auto.get('eyes', []), 'brows': [[[p[0], p[1], min(p[2], 12)] for p in b['pts']] for b in auto.get('brows', [])]}
    if 'eyesKeep' in man:
        f['eyes'] = f['eyes'][:1] if man['eyesKeep'] == 1 else f['eyes']
    for k, v in man.items():
        if k != 'eyesKeep':
            f[k] = v
    for e in f['eyes']:
        e.pop('n', None)
    f.setdefault('paint', {})
    return f


def write_js(data, path):
    r1 = lambda v: float('%.1f' % v)
    lines = ['// Captain Kite\'s shapes, traced from the pack\'s reference sheets (sheets/*.png) by tools/trace-sheets.py.',
             '// Generated: do not edit by hand (change the tracer and run it again). Coordinates are sheet pixels.',
             '// A figure: { sheet, box: [x0, y0, x1, y1], bg, line, lineW, face, shapes: [[group, part, flat, shadow, reach, light,',
             '//   ink, [x, y, x, y, ...]], ...] }: each shape a flat cel region (its colour, its cel shadow\'s colour, reach and',
             '//   light angle, how much of its edge the sheet inks), in drawing order; face: the eyes, irises, brows, nose and mouth measured on the sheet (see the tracer).',
             '(function () {', '  const CharacterLab = (window.CharacterLab = window.CharacterLab || {});', '  CharacterLab.kiteShapes = {']
    for fid, r in data.items():
        head = {k: r[k] for k in ('sheet', 'box', 'bg', 'line', 'lineW')}
        if 'face' in r:
            head['faceBox'] = r['faceBox']
            head['face'] = r['face']
        js = json.dumps(head, separators=(',', ':'))[:-1]
        lines.append('    %s: %s,"shapes":[' % (json.dumps(fid), js))
        for t in r['shapes']:
            flat = [v for p in t['pts'] for v in p]
            lines.append('      %s,' % json.dumps([t['g'], t['part'], t['c'][0], t['c'][1], r1(t['sh']), t['la'], t['ink'], flat], separators=(',', ':')))
        lines.append('    ],"lines":[')
        for t in r.get('lines', []):
            lines.append('      %s,' % json.dumps([t['part'], t['w'], [v for p in t['pts'] for v in p]], separators=(',', ':')))
        lines.append('    ]},')
    lines += ['  };', '})();', '']
    open(path, 'w').write('\n'.join(lines))


def main(only=None):
    cache, out = {}, {}
    for fid, (sheet, box, face, parts) in FIGURES.items():
        if only and fid not in only:
            continue
        r = trace_figure(fid, sheet, box, face, parts, cache)
        if 'face' in r:
            r['face'] = face_of(fid, r['face'])
        out[fid] = r
        print('%-16s shapes %3d points %5d lineW %.1f' % (fid, len(r['shapes']), sum(len(s['pts']) for s in r['shapes']), r['lineW']), file=sys.stderr)
    return out


if __name__ == '__main__':
    only = sys.argv[1:] or None
    data = main(only)
    if only:
        json.dump(data, sys.stdout)
    else:
        write_js(data, OUT)
        print('wrote', OUT, os.path.getsize(OUT), 'bytes', file=sys.stderr)

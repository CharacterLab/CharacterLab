// Character Lab renderer (WebGL2, no libraries): flat illustrations built from layers of draw ops. Each layer: SDF shape
// -> flat base colour -> the material (by default "painted": a soft wash with weak light, pigment blooms,
// granulation and paper grain) -> edge treatment -> sparse pencil detail.
// World space = reference pixels of the target figure. A view maps world -> canvas px.
//   const r = CharacterLab.wcGL.create(canvas); r.render({ ops, world: [w, h] }, { scale, ox, oy }, { paper: "#fff" });
//
// Draw ops (op.kind): fill, shadow (multiply), clip, outline, stroke, blush (multiply), halo, eye; more from extensions.
// Fill materials (mat.type): 6 painted wash (the default), 1 soft pool, 8 cel; more from extensions.
//
// Extensions: a pack adds its own materials and draw modes as GLSL chunks, spliced into the fragment shader before it
// compiles. Register them before the first renderer is created (load the script right after js/wc-gl.js); later
// registrations throw. Chunks go in a fixed order: each registration after the ones it requires, otherwise by id.
//   CharacterLab.wcGL.registerMaterial({
//     id: "stone",                      // a-z, 0-9, -; unique among every registration
//     type: 12,                         // optional: answers mat.type 12 on fill ops (1, 6 and 8 are the engine's)
//     base: "wash",                     // "wash" (default): glsl.fn gets the painted wash in col; "none": col = ramp[2]
//     requires: ["other-id"],           // optional: registrations whose declarations this one uses
//     uniforms: { uGrain: "float" },    // declared before glsl.decl
//     glsl: {
//       decl: "float grain(vec2 p) { … }",           // functions shared by this registration (and those requiring it)
//       fn: "col *= 0.9 + 0.2 * grain(pm);",          // with type: statements on vec3 col; in scope p (world), d (signed
//                                                     // distance, < 0 inside), grad (outward normal), pm (p in the
//                                                     // material's frame, turned by mat.rot about op.off)
//       wash: "col *= 1.0;",                          // optional: statements spliced into the painted wash after its
//     },                                              // brush strokes (vec3 col, vec2 p, float d, vec2 grad)
//     setUniforms(gl, loc, mat, op) { gl.uniform1f(loc.uGrain, mat.grain || 0); },   // called for every op drawn
//   });
//   CharacterLab.wcGL.registerMode({
//     id: "ring", kind: "ring",         // ops of this kind are drawn by it
//     blend: "over",                    // "over" (premultiplied alpha, default), "multiply" or "clip"
//     requires: [], uniforms: {},
//     glsl: { decl: "…", fn: "float d = …; o = vec4(uC2, 1.0); return;" },   // the body of main()'s branch: writes o
//     setUniforms(gl, loc, mat, op) { … },             // called for its ops only, after the materials'
//     box(op, mat) { return [x0, y0, x1, y1]; },       // the world rectangle to draw
//     reach(op) { return [[x, y], …]; },               // optional: the points it covers, for the rig's layer textures
//   });
//   CharacterLab.wcGL.fragmentSource()  the composed shader; CharacterLab.wcGL.extensions()  the registrations in splice order.
// Every engine helper is in scope for the chunks: hash12/22/42, vnoise, fbm, ss, rot, splat, wisps, sdEllipse, sdPoly,
// sdLine, domeNormal, wash, softEdge, pencil, LIGHT, and the engine's uniforms (uC0..uC3 = mat.ramp, uSeed, uPx, uOff,
// uAmt, uW, uTint, uRadius, uFuzz, uFur, uAlpha, uSoft, uMatRot, uTex, …).
//
// Cel (mat.type 8), an anime look: flat base colour ramp[2]; one hard-edged shadow tone ramp[0] on the side away from
// the light, cut along the shape's own outline moved toward the light (mat.light: the direction the light comes from,
// radians, 0 = from the right, -PI/2 = from above; default -3PI/4, the upper left; mat.shadow: how far in the shadow
// reaches, world units, default 6); an optional rim light ramp[3] cut the same way along the lit edge (mat.rim, world
// units); an even outline (mat.line colour, mat.lineW world units, default 1.5, 0 = none); mat.clean: crisp edges, no
// paper grain or edge noise (otherwise mat.fuzz roughens the edge and a faint paper grain stays).
//   { kind: "fill", pts: ellipse(100, 120, 60, 70), mat: { type: 8, ramp: ["#c97f6a", "#c97f6a", "#f6c4a8", "#fff1e4"],
//     light: -2.3, shadow: 14, rim: 3, line: "#3a2420", lineW: 2, clean: true }, seed: 3 }
//
// Opt-in features (each off by default: an op without the field draws exactly as before).
//   Eye op (kind "eye"):
//     lowLine 0..1   the lower lash: 1 = the heavy dark lower ring (default), 0.2 = a thin lower lash, 0 = none
//                    (the lash wrapping the outer corner keeps half its weight).
//     irisAspect     an elliptical iris: rx / ry (0.8 = a tall oval) at the same mean radius irisR (a number). Or
//                    irisR [rx, ry] directly (transformOps in wc-elements.js scales both). irisTilt in radians (+ = clockwise on screen, like
//                    ellipse(..., rot)); irisEgg -0.5..0.5 (+ = the broad end down). The pupil takes the same shape;
//                    pupilR and the glints are sized by R = (rx + ry) / 2.
//     lowLid 0..1    a lower lid rising as a soft dome (smiling, squinting eyes), with a soft line along its edge;
//                    mat.alpha fades the whole eye (a crossfade into a closed-eye picture).
//     lidArch 0..1   the upper lid as measured on the painted half-open and sleepy eyes: an arch (the corners come
//                    down further than the middle, most at lid 1/3) that flattens as it closes; 0 = today's sagging
//                    lid. Where the arch would rise above the eye, the lash line stays on the eye's rim.
//       { kind: "eye", c: [100.5, 141.2], r: [18.3, 17.2], iris: [2.7, 1.8], irisR: 13.8, irisAspect: 0.83, irisTilt: 0.15,
//         irisEgg: 0.2, pupilR: 8.3, lid: 0.35, lidArch: 1, lowLine: 0.2, glint: [0.07, -0.52, 0.2, 0.09],
//         amt: 1, rich: 1, mat: { ramp: FACE.eye, line: LASH }, seed: 81 }
//   Halo (kind "halo"): a soft-edged pool of colour laid over with normal alpha, so it shows on bare paper (blush and
//     shadow multiply, and vanish there). tint, amt (its peak alpha, default 0.3), mat.soft (the falloff outside the
//     outline), mat.radius (inside it), mat.fuzz (a ragged, bleeding edge).
//       { kind: "halo", pts: ellipse(100, 141, 24, 20), tint: "#d9b89a", amt: 0.45, mat: { soft: 6, radius: 5, fuzz: 0.6 }, seed: 9 }
//   Pool gradient (mat.type 1): mat.grad [top, bottom] multiplies the pool's depth (how far it goes from ramp[2] at
//     the edge toward ramp[0]) from the top of the shape to its bottom; mat.gradA [top, bottom] multiplies its alpha.
//     The gradient runs down the shape's own axis, turned by mat.rot (radians) for a tilted bowl.
//       { kind: "fill", pts: bowl, mat: { type: 1, ramp: PAL.earBowl, radius: 7, soft: 2.2, alpha: 0.95, grad: [1.6, 0.4], gradA: [1, 0.35], rot: 0.3 }, seed: 13 }
(function () {
  const CharacterLab = (window.CharacterLab = window.CharacterLab || {});
  const MAXN = 1024;

  const VS = `#version 300 es
in vec2 aPos;
uniform vec4 uBox;   // world bbox x0 y0 x1 y1
uniform vec3 uView;  // scale, ox, oy  (canvas = world*scale + o)
uniform vec2 uRes;
out vec2 vW;
void main() {
  vec2 w = mix(uBox.xy, uBox.zw, aPos);
  vW = w;
  vec2 c = w * uView.x + uView.yz;
  vec2 n = c / uRes * 2.0 - 1.0;
  gl_Position = vec4(n.x, -n.y, 0.0, 1.0);
}`;

  // The part shader, in two halves: the engine's helpers (the painted wash takes the extensions' wash chunks at
  // its /*@wash*/ mark) and its main().
  const FS_HEAD = `#version 300 es
precision highp float;
precision highp int;
in vec2 vW;
out vec4 o;
uniform float uPx;    // world units per device pixel
uniform float uSeed;
const vec3 LIGHT = normalize(vec3(-0.5, -0.62, 0.62));  // upper-left, y down

float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
vec4 hash42(vec2 p) { vec4 p4 = fract(vec4(p.xyxy) * vec4(.1031, .1030, .0973, .1099)); p4 += dot(p4, p4.wzxy + 33.33); return fract((p4.xxyz + p4.yzzw) * p4.zywx); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
float ss(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
// A few random short strokes (max over 3x3 cells). Returns (coverage, per-stroke random).
vec2 splat(vec2 p, float cell, float len, float w, float ang, float jit, float dens, float seed) {
  vec2 g = floor(p / cell); vec2 best = vec2(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 c = g + vec2(i, j);
    vec4 h = hash42(c + seed * 17.31);
    if (h.w > dens) continue;
    vec2 ctr = (c + h.xy) * cell;
    float a = ang + (h.z - 0.5) * 2.0 * jit;
    vec2 dir = vec2(cos(a), sin(a));
    float L = len * (0.6 + 0.8 * fract(h.z * 7.13 + h.x));
    vec2 q = p - ctr; float t = clamp(dot(q, dir), -0.5 * L, 0.5 * L);
    float hw = 0.5 * w * (1.0 - smoothstep(0.25, 0.5, abs(t) / L));
    float cov = 1.0 - smoothstep(hw, hw + uPx, length(q - dir * t));
    if (cov > best.x) best = vec2(cov, fract(h.w * 13.7 + h.y * 3.1));
  }
  return best;
}
// Soft wisps of fur: tapered strands with a feathered edge (max over 3x3 cells), for fluffy outlines.
float wisps(vec2 p, float cell, float len, float w, float ang, float jit, float dens, float seed) {
  vec2 g = floor(p / cell); float best = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 c = g + vec2(i, j);
    vec4 h = hash42(c + seed * 17.31);
    if (h.w > dens) continue;
    float a = ang + (h.z - 0.5) * 2.0 * jit;
    vec2 dir = vec2(cos(a), sin(a)), q = p - (c + h.xy) * cell;
    float L = len * (0.6 + 0.8 * fract(h.z * 7.13 + h.x));
    float t = clamp(dot(q, dir) / L + 0.5, 0.0, 1.0);
    float hw = 0.5 * w * pow(1.0 - t, 0.8) * ss(0.0, 0.25, t);    // thick at the root, a fine tip
    float dd = length(q - dir * (t - 0.5) * L);
    best = max(best, (1.0 - ss(hw * 0.2, hw + 0.7, dd)) * (0.55 + 0.45 * h.y));
  }
  return best;
}
float sdEllipse(vec2 p, vec2 r) { float k0 = length(p / r); float k1 = length(p / (r * r)); return k0 * (k0 - 1.0) / max(k1, 1e-5); }
uniform sampler2D uPoly; uniform int uRow; uniform int uN;
uniform int uMode;   // 0 fill, 1 shadow(multiply), 2 clip, 3 outline, 4 stroke, 5 blush(multiply), 6 eye, 7 cel fill,
                     // 11 halo (normal alpha: shows on bare paper); registered modes from 32 up (registerMode)
uniform int uMat;    // 1 soft pool, 6 painted wash (default), 8 cel; other types: registered materials (registerMaterial)
uniform vec3 uC0, uC1, uC2, uC3;
uniform vec3 uLineCol;
uniform float uRadius, uFur, uFuzz, uLine, uLineW, uEdge, uAlpha, uSoft, uLight, uBottom, uStrokes, uSide;
uniform vec2 uOff; uniform float uAmt; uniform vec3 uTint; uniform vec2 uW;
uniform vec2 uEyeC, uEyeR, uIrisOff; uniform float uLid, uIrisR, uPupilR; uniform vec4 uGl;
uniform float uTex;                                                // surface texture strength (1 = default): scales the brush strokes; a wash extension may add its own above 1
uniform float uFurLen;                                             // edge fur length (1 = default; above 1 adds tufts)
uniform float uRim;                                                // wash: a soft darker falloff all round the edge (0 = off); cel: the rim light's width
uniform float uEyeRich;                                            // eye: socket-lit sclera, fibred iris, limbal ring, wrapped lash line (0 = off)
uniform float uLowLine;                                            // eye: lower lash weight (1 = default heavy ring, 0.2 thin, 0 none)
uniform float uIrisShape; uniform vec4 uIrisE;                     // eye: shaped iris on (0 = round): rx / R, ry / R, tilt, egg
uniform float uLidArch;                                            // eye: the upper lid arches, flattening as it closes (0 = default sag)
uniform float uLowLid;                                             // eye: the lower lid rises as a soft dome, the cheek pushing up (0 = off)
uniform float uMatRot;                                             // a material's own frame turned (radians) about uOff (pool gradient, registered materials)
uniform float uGradOn; uniform vec4 uGrad; uniform vec2 uGradAx, uGradT;   // pool: depth top, bottom, alpha top, bottom; axis; its extent (0 = off)
uniform vec2 uCelL; uniform float uCelShadow, uClean;              // cel: toward the light (unit), the shadow's reach (world units), no paper (1)


float sdPoly(vec2 p, out vec2 grad) {
  float d = 1e20, s = 1.0; vec2 bd = vec2(0.0, 1.0);
  vec2 prev = texelFetch(uPoly, ivec2(uN - 1, uRow), 0).xy;
  for (int i = 0; i < ${MAXN}; i++) {
    if (i >= uN) break;
    vec2 cur = texelFetch(uPoly, ivec2(i, uRow), 0).xy;
    vec2 e = prev - cur, w = p - cur;
    vec2 b = w - e * clamp(dot(w, e) / max(dot(e, e), 1e-9), 0.0, 1.0);
    float dd = dot(b, b);
    if (dd < d) { d = dd; bd = b; }
    bvec3 c = bvec3(p.y >= cur.y, p.y < prev.y, e.x * w.y > e.y * w.x);
    if (all(c) || all(not(c))) s *= -1.0;
    prev = cur;
  }
  float dist = s * sqrt(d);
  grad = normalize(bd + 1e-6) * sign(dist);
  return dist;
}
float sdLine(vec2 p, out float tpar) {
  float d = 1e20, acc = 0.0, total = 0.0, best = 0.0;
  for (int i = 1; i < ${MAXN}; i++) { if (i >= uN) break; total += distance(texelFetch(uPoly, ivec2(i, uRow), 0).xy, texelFetch(uPoly, ivec2(i - 1, uRow), 0).xy); }
  vec2 a = texelFetch(uPoly, ivec2(0, uRow), 0).xy;
  for (int i = 1; i < ${MAXN}; i++) {
    if (i >= uN) break;
    vec2 b = texelFetch(uPoly, ivec2(i, uRow), 0).xy;
    vec2 e = b - a, w = p - a; float h = clamp(dot(w, e) / max(dot(e, e), 1e-9), 0.0, 1.0);
    float dd = length(w - e * h);
    if (dd < d) { d = dd; best = acc + h * length(e); }
    acc += length(e); a = b;
  }
  tpar = best / max(total, 1e-6);
  return d;
}
// weak dome normal: only a hint of volume
vec3 domeNormal(float d, vec2 grad, float radius) {
  float t = clamp(-d / radius, 0.0, 1.0);
  float h = sqrt(max(1e-4, 1.0 - (1.0 - t) * (1.0 - t)));
  float dh = (1.0 - t) / max(h, 0.1);
  return normalize(vec3(grad * dh * 0.35, 1.0));
}
// The painted wash over a flat base colour.
vec3 wash(vec3 col, vec2 p, float d, vec2 grad) {
  vec3 n = domeNormal(d, grad, uRadius);
  col *= 1.0 + uLight * (max(dot(n, LIGHT), 0.0) - LIGHT.z);             // weak volume
  float bottom = (1.0 - smoothstep(0.0, uEdge, -d)) * smoothstep(-0.2, 0.9, grad.y);
  col = mix(col, uC1, bottom * uBottom);                                  // warm shadow at the bottom
  float sides = (1.0 - smoothstep(0.0, uEdge * 1.3, -d)) * abs(grad.x);
  col = mix(col, uC0, sides * uSide);                                     // rounded sides: a soft warm edge shade
  col *= 1.0 + (fbm(p * 0.035 + uSeed) - 0.5) * 0.07;                     // low-frequency pigment blooms
  col *= 1.0 + (vnoise(p * 0.45 + uSeed * 2.0) - 0.5) * 0.03;             // granulation
  col = mix(col, col * 0.94, (1.0 - smoothstep(0.0, 2.2, -d)) * 0.55);   // pigment pools at the edge
  if (uStrokes > 0.0) {                                                   // short soft fur strokes, pointing outward
    float flow = atan(grad.y, grad.x) + (vnoise(p * 0.05 + uSeed) - 0.5) * 1.2;
    vec2 s1 = splat(p, 4.6, 4.0, 0.75, flow, 0.55, uStrokes, uSeed + 11.0);
    vec2 s2 = splat(p + 9.0, 3.2, 3.0, 0.6, flow + 0.3, 0.7, uStrokes * 0.8, uSeed + 19.0);
    col *= 1.0 + (s1.x * (s1.y > 0.45 ? 0.035 : -0.05) + s2.x * (s2.y > 0.5 ? 0.03 : -0.04)) * uTex;
  }
/*@wash*/
  if (uRim > 0.0) col = mix(col, uC1, (1.0 - ss(0.0, uRim, -d)) * 0.55);  // the form turns away all round
  col *= 0.985 + 0.03 * vnoise(p * 1.1 + 7.0);                            // paper grain
  return col;
}
float softEdge(vec2 p, float d, vec2 grad) {
  float dn = d + (fbm(p * 0.22 + uSeed) - 0.5) * uFuzz * 2.0;
  float aa = uPx * 1.3 + 0.35;
  float a = 1.0 - smoothstep(-aa, aa, dn);
  if (uFur > 0.0) {                                                        // sparse hairs over the edge
    vec2 hs = splat(p, 3.0, 4.5 * uFurLen, 0.55, atan(grad.y, grad.x), 0.45, 0.6 * uFur, uSeed + 3.0);
    float band = (1.0 - smoothstep(-1.0, 3.2 * uFurLen, d)) * step(-1.5, d);
    a = max(a, hs.x * band * 0.75);
    if (uFurLen > 1.0) {                                                   // soft wisps of fur crossing the edge
      float tf = wisps(p + 3.7, 3.4, 6.0 * uFurLen, 1.8, atan(grad.y, grad.x), 0.35, 0.6 * uFur, uSeed + 5.0);
      a = max(a, tf * (1.0 - smoothstep(0.0, 3.6 * uFurLen, d)) * step(-2.0, d) * 0.8);
    }
  }
  return a * (0.97 + 0.03 * vnoise(p * 1.1 + 7.0));
}
float pencil(vec2 p, float d) {
  if (uLine <= 0.0) return 0.0;
  float w = uLineW * (0.6 + 0.8 * vnoise(p * 0.12 + uSeed));
  float ln = 1.0 - smoothstep(w, w + uPx * 1.3, abs(d + w * 0.4));
  float brk = smoothstep(0.42, 0.66, vnoise(p * 0.045 + uSeed * 3.1));  // mostly gaps: sparse and broken
  return ln * brk * uLine;
}
// Cel (mat.type 8): a flat base colour (ramp[2]); one hard shadow tone (ramp[0]) where the shape, moved away from the
// light by uCelShadow, no longer covers the pixel (so the shadow's edge is the outline's own offset); an optional rim
// light (ramp[3]) on the lit side, cut the same way uRim in from the edge; an even outline uLineW wide inside the edge.
// uClean: crisp edges and flat colour, no paper grain (0 = a little grain and mat.fuzz on the edge).
vec4 celFill(vec2 p, float d) {
  float aa = uPx * 0.75;
  float dn = uClean > 0.5 ? d : d + (fbm(p * 0.22 + uSeed) - 0.5) * uFuzz * 2.0;
  float a = 1.0 - smoothstep(-aa, aa, dn);
  if (a < 0.003) return vec4(0.0);
  vec2 g;
  float sh = smoothstep(-aa, aa, sdPoly(p - uCelL * uCelShadow, g));      // 1 in the shadow
  vec3 col = mix(uC2, uC0, sh);
  if (uRim > 0.0) col = mix(col, uC3, smoothstep(-aa, aa, sdPoly(p + uCelL * uRim, g)) * (1.0 - sh));
  if (uLineW > 0.0) col = mix(col, uLineCol, 1.0 - smoothstep(uLineW - aa, uLineW + aa, -d));
  if (uClean < 0.5) col *= 0.985 + 0.03 * vnoise(p * 1.1 + 7.0);         // paper grain
  a *= uAlpha;
  return vec4(col * a, a);
}
`;

  // Then each registration's uniforms and GLSL declarations (registerMaterial / registerMode), then main().
  const FS_MAIN = `
void main() {
  vec2 p = vW;
  if (uMode == 0) {
    vec2 grad; float d = sdPoly(p, grad);
    float a = softEdge(p, d, grad);
    if (a < 0.003) discard;
    vec3 col;
/*@fill-base*/    if (uMat == 1) {                             // soft pool of colour: darkest in the middle
      float k = smoothstep(0.0, uRadius, -d), ga = 1.0;
      if (uGradOn > 0.0) {                       // a gradient along the pool (down its own axis): depth and alpha, top to bottom
        float t = clamp((dot(p, uGradAx) - uGradT.x) / max(uGradT.y - uGradT.x, 1e-3), 0.0, 1.0);
        k = clamp(k * mix(uGrad.x, uGrad.y, t), 0.0, 1.0);
        ga = max(mix(uGrad.z, uGrad.w, t), 0.0);
      }
      col = mix(uC2, uC0, k) * (1.0 + (fbm(p * 0.1 + uSeed) - 0.5) * 0.1);
      a *= smoothstep(-0.5, uSoft, -d);
      if (uGradOn > 0.0) a = min(a * ga, 1.0);
    } else {
      col = wash(uC2, p, d, grad);
      vec2 pm = p;                               // the material's own frame: turned by uMatRot about uOff
      if (uMatRot != 0.0) pm = uOff + rot(-uMatRot) * (p - uOff);
/*@fill-over*/    }
    col = mix(col, uLineCol, pencil(p, d));
    a *= uAlpha;
    o = vec4(col * a, a); return;
  }
  if (uMode == 1) { // soft drop shadow onto what is below (multiply)
    vec2 g; float d = sdPoly(p - uOff, g);
    float k = uAmt * (1.0 - smoothstep(-uSoft * 0.3, uSoft, d));
    o = vec4(mix(vec3(1.0), uTint, k), 1.0); return;
  }
  if (uMode == 2) { // clip: keep only inside
    vec2 g; float d = sdPoly(p, g);
    o = vec4(1.0 - smoothstep(-uPx, uPx, d)); return;
  }
  if (uMode == 3) { // sparse broken outline only
    vec2 g; float d = sdPoly(p, g);
    float a = pencil(p, d);
    if (a < 0.003) discard;
    o = vec4(uLineCol * a, a); return;
  }
  if (uMode == 4) { // tapered stroke along an open polyline (mouth, brows, toe lines)
    float t; float d = sdLine(p, t);
    float taper = smoothstep(0.0, 0.2, t) * ss(1.0, 0.8, t);
    float hw = mix(uW.x, uW.y, t) * (0.5 + 0.5 * taper) * (0.85 + 0.3 * vnoise(p * 0.3 + uSeed));
    float a = (1.0 - smoothstep(hw, hw + uPx * 1.3, d)) * uAlpha * (0.82 + 0.18 * vnoise(p * 1.3 + uSeed));
    if (a < 0.003) discard;
    o = vec4(uLineCol * a, a); return;
  }
  if (uMode == 5) { // blush: soft, speckled pigment multiplied into the paper
    vec2 g; float d = sdPoly(p, g);
    float k = ss(uSoft, -uRadius, d);
    float speck = 0.8 + 0.4 * vnoise(p * 0.5 + uSeed) - 0.2 * step(0.72, vnoise(p * 1.3));
    k = clamp(k * speck, 0.0, 1.0) * uAmt;
    o = vec4(mix(vec3(1.0), uTint, k), 1.0); return;
  }
  if (uMode == 11) { // halo: a soft-edged pool of colour laid over (normal alpha), so it shows on bare paper too
    vec2 g; float d = sdPoly(p, g);
    d += (fbm(p * 0.22 + uSeed) - 0.5) * uFuzz * 2.0;                     // a ragged, bleeding edge (mat.fuzz)
    float k = ss(uSoft, -uRadius, d) * (0.9 + 0.2 * vnoise(p * 0.5 + uSeed));
    float a = clamp(k, 0.0, 1.0) * uAmt;
    if (a < 0.003) discard;
    vec3 col = uTint * (1.0 + (fbm(p * 0.1 + uSeed) - 0.5) * 0.08);      // pigment mottling
    o = vec4(col * a, a); return;
  }
  if (uMode == 6) { // eye: heavy lid line on top, white outer crescent, dark iris lighter below, small glints
    vec2 q = (p - uEyeC);
    float de = sdEllipse(q, uEyeR);
    float aa = uPx * 1.2;
    float topness = ss(0.25, -0.95, q.y / uEyeR.y);
    float outer = ss(0.15, 0.9, -q.x * uAmt / uEyeR.x) * ss(0.7, -0.1, q.y / uEyeR.y);   // the lash line wraps the outer side
    float thick = mix(topness, max(topness, outer * 0.5), uEyeRich);
    float lw = mix(mix(0.7, 3.0, topness), mix(1.15, 3.0, thick), uEyeRich) * mix(max(1.0, uEyeR.y / 18.0), 1.0, uEyeRich);  // larger eyes get a heavier lid line
    float lowA = 1.0;
    if (uLowLine != 1.0) {                       // the lower lash: thinner and lighter (0 = none); the outer wrap keeps half
      float low = ss(-0.05, 0.5, q.y / uEyeR.y) * (1.0 - thick);
      lw *= mix(1.0, mix(0.35, 1.0, max(uLowLine, 0.0)), low);
      lowA = mix(1.0, clamp(uLowLine * 2.5, 0.0, 1.0), low);
    }
    float cov = 1.0 - smoothstep(-aa, aa, de - lw * 0.3);
    if (cov < 0.003 && uLid < 0.02) discard;
    vec3 col = mix(uC3 * 0.83, uC3, smoothstep(-uEyeR.y * 0.9, uEyeR.y * 0.2, q.y));   // ramp: iris top, iris bottom, pupil, white
    vec2 qi = q - uIrisOff, qs = qi;
    if (uIrisShape > 0.0) {                      // an elliptical / egg iris: measured in the space where it is a circle of radius R
      qs = rot(-uIrisE.z) * qi;
      qs = vec2(qs.x / (uIrisE.x * max(0.2, 1.0 + uIrisE.w * clamp(qs.y / (uIrisE.y * uIrisR), -1.0, 1.0))), qs.y / uIrisE.y);
    }
    float ri = length(qs); float R = uIrisR;
    float ang = atan(qs.y, qs.x);
    float yy = clamp(qs.y / R * 0.5 + 0.5, 0.0, 1.0);
    vec3 iris = mix(uC0, uC1, smoothstep(0.45, 1.0, yy));
    iris *= 0.9 + 0.2 * vnoise(vec2(ang * 10.0, ri * 0.4) + uSeed);
    if (uEyeRich > 0.0) {
      // The white is a ball: the lid shades its top, and it greys toward its rim.
      col = mix(col, uC3 * vec3(0.8, 0.77, 0.75), ss(0.0, -0.95, q.y / uEyeR.y) * 0.15 * uEyeRich);
      // The iris: dark under the lid, warm below, fine radial fibres, a glow under the pupil, a dark rim.
      vec3 ir = mix(uC0, uC1, ss(0.25, 0.95, yy));
      ir *= 0.8 + 0.4 * vnoise(vec2(ang * 16.0, ri * 0.25) + uSeed);
      ir = mix(ir, uC1 * 1.3, ss(0.55, 1.0, yy) * ss(R * 0.95, R * 0.6, ri) * 0.4);
      ir = mix(ir, uC0 * 0.45, ss(R * 0.78, R * 0.99, ri) * 0.6);
      ir *= mix(1.0, 0.72, ss(0.45, 0.0, yy));
      iris = mix(iris, ir, uEyeRich);
    }
    float irisM = 1.0 - smoothstep(R - aa, R + aa, ri);
    col = mix(col, iris, irisM);
    float pupil = 1.0 - smoothstep(uPupilR - aa, uPupilR + aa, ri);
    col = mix(col, uC2, pupil);
    col *= mix(1.0, 0.8, ss(-0.2, -1.0, q.y / uEyeR.y) * 0.6);
    float g1 = 1.0 - smoothstep(R * uGl.z - aa, R * uGl.z + aa, length(qi - vec2(uGl.x * uAmt, uGl.y) * R));
    float g2 = 1.0 - smoothstep(R * uGl.w - aa, R * uGl.w + aa, length(qi - mix(vec2(-0.3 * uAmt, 0.42), vec2(-0.5 * uAmt, 0.7), uEyeRich) * R));
    col = mix(col, vec3(1.0), g1);
    col = mix(col, mix(vec3(1.0), vec3(0.85, 0.72, 0.6), uEyeRich), g2 * 0.5);   // the small glint: a warm reflected light
    float line = 1.0 - smoothstep(lw * 0.5, lw * 0.5 + aa * 1.5, abs(de + lw * 0.25));
    line *= mix(mix(0.45, 1.0, topness), mix(0.9, 1.0, thick), uEyeRich) * (0.82 + 0.18 * vnoise(p * 0.7 + uSeed));
    if (uLowLine != 1.0) line *= lowA;
    col = mix(col, uLineCol, line);
    // Lids: the upper lid comes down as a sleepy arc; near closed, the lower lid rises to meet it.
    // Covered parts turn transparent so the textured face shows through; one dark lash line remains.
    float xn = clamp(q.x / uEyeR.x, -1.0, 1.0);
    float lidY = mix(-1.08, 0.12, uLid) * uEyeR.y + uLid * 0.28 * uEyeR.y * (1.0 - xn * xn);
    // An arched lid (as measured on the painted half-open and sleepy eyes): the middle comes down with the lid, the
    // corners lower still, most at lid 1/3; it flattens as it closes, into a flat line a quarter radius below the centre.
    if (uLidArch > 0.0) lidY = mix(lidY, (-1.1 + 1.35 * uLid + 2.63 * uLid * (1.0 - uLid) * (1.0 - uLid) * xn * xn) * uEyeR.y, uLidArch);
    float lowY = mix(1.25 * uEyeR.y, lidY + 0.6, smoothstep(0.65, 1.0, uLid));
    // A lower lid (smiling and squinting eyes): its edge rises from below the eye to above its centre at 1, highest in
    // the middle (a dome: the cheek pushes it up), with a soft line along it.
    float lowEdge = (mix(1.12, -0.32, uLowLid) - 0.32 * uLowLid * (1.0 - xn * xn)) * uEyeR.y;
    if (uLowLid > 0.0) lowY = min(lowY, lowEdge);
    float lidM = max(ss(lidY + aa, lidY - aa, q.y), ss(lowY - aa, lowY + aa, q.y)) * step(0.01, max(uLid, uLowLid));
    float aEye = cov * (1.0 - lidM);
    float lash = (1.0 - smoothstep(0.85, 0.85 + aa, abs(q.y - lidY))) * step(0.02, uLid) * (1.0 - smoothstep(-0.5, 1.2, abs(q.x) - uEyeR.x * 0.96));
    // The lid's lash line hugs the eye: clipped to its outline (above the eye, the eye's own lash line is the edge; a
    // straight bar wider than the eye read as a floating line at small lids), and it fades in as the lid starts down.
    lash *= 1.0 - smoothstep(0.0, 0.8 + aa, de - lw * 0.3);
    lash *= ss(0.02, 0.08, uLid);
    lash *= 0.85 + 0.15 * vnoise(p * 0.7 + uSeed);
    if (uLowLid > 0.0) {                         // the lower lid's soft line, on the eye only
      float ll = (1.0 - smoothstep(0.35, 0.35 + aa * 1.5, abs(q.y - lowY))) * ss(0.02, 0.12, uLowLid) * 0.45;
      lash = max(lash, ll * (1.0 - smoothstep(0.0, 0.8 + aa, de - lw * 0.3)) * step(lowY, lowEdge + 0.01));
    }
    vec3 rgb = uLineCol * lash + col * aEye * (1.0 - lash);
    float alpha = lash + aEye * (1.0 - lash);
    if (alpha < 0.003) discard;
    o = vec4(rgb, alpha) * uAlpha; return;   // mat.alpha: the whole eye fades (a crossfade into a closed-eye picture)
  }
  if (uMode == 7) { // a cel fill (fill ops with mat.type 8)
    vec2 g; float d = sdPoly(p, g);
    o = celFill(p, d); if (o.a < 0.003) discard; return;
  }
/*@modes*/  o = vec4(0);
}`;

  const FS_COMP = `#version 300 es
precision highp float;
in vec2 vW; out vec4 o;
uniform sampler2D uAcc; uniform vec2 uRes; uniform vec3 uPaper; uniform int uTransparent;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec4 c = texture(uAcc, uv);
  if (uTransparent == 1) { o = c; return; }
  o = vec4(c.rgb + uPaper * (1.0 - c.a), 1.0);
}`;

  // A rig layer's texture laid over the canvas with its part's matrix (renderRig): each fragment's world position is
  // taken back through the inverse matrix to the still layer, and sampled there (soft, linear). A multiply layer is
  // white outside its texture.
  const FS_SPRITE = `#version 300 es
precision highp float;
in vec2 vW; out vec4 o;
uniform sampler2D uTex; uniform vec2 uTexSize, uTexOrigin; uniform vec3 uView; uniform vec3 uI0, uI1; uniform int uMul;
void main() {
  vec2 wl = vec2(dot(uI0, vec3(vW, 1.0)), dot(uI1, vec3(vW, 1.0)));
  vec2 px = wl * uView.x + uView.yz - uTexOrigin, uv = vec2(px.x / uTexSize.x, 1.0 - px.y / uTexSize.y);
  bool out_ = any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)));
  o = out_ ? (uMul == 1 ? vec4(1.0) : vec4(0.0)) : texture(uTex, uv);
}`;

  function hex(c) {
    const n = parseInt(c.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  // ---------- extensions: registerMaterial / registerMode (see the header) ----------
  // Kept on CharacterLab, so loading this file again (inspect.html's baseline) keeps what the packs registered.
  const REG = (CharacterLab.wcGLExtensions = CharacterLab.wcGLExtensions || []);
  const CEL = 8, CEL_LIGHT = -0.75 * Math.PI;                     // cel's default light: from the upper left
  const BUILTIN_TYPES = new Set([1, 6, CEL]);
  const BUILTIN_KINDS = new Set(["fill", "shadow", "clip", "outline", "stroke", "blush", "halo", "eye"]);
  const FIRST_MODE = 32;                                          // registered draw modes are numbered from here
  const EXT_ID = /^[a-z][a-z0-9-]*$/, UNIFORM = /^u[A-Z][A-Za-z0-9]*$/, GLSL_TYPE = /^(float|int|bool|[iu]?vec[234]|mat[234]|sampler2D)$/;
  let built = null;                                               // the composed shader, once the first renderer exists

  function addExtension(what, def) {
    const where = what === "mode" ? "registerMode" : "registerMaterial";
    const fail = (msg) => { throw new Error(`CharacterLab.wcGL.${where}${def && def.id ? ` "${def.id}"` : ""}: ${msg}`); };
    if (built) fail("too late: the first renderer was already created (load extensions right after js/wc-gl.js)");
    if (!def || typeof def !== "object") fail("needs a definition");
    const { id, glsl = {}, uniforms = {}, requires = [] } = def;
    if (typeof id !== "string" || !EXT_ID.test(id)) fail(`bad id ${JSON.stringify(id)}`);
    if (REG.some((e) => e.id === id)) fail("registered twice");
    if (!glsl || typeof glsl !== "object") fail("glsl must be { decl, fn, wash }");
    for (const k of ["decl", "fn", "wash"]) if (glsl[k] != null && typeof glsl[k] !== "string") fail(`glsl.${k} must be a string`);
    for (const [n, t] of Object.entries(uniforms)) if (!UNIFORM.test(n) || !GLSL_TYPE.test(t)) fail(`bad uniform ${n}: ${t}`);
    if (!Array.isArray(requires) || !requires.every((r) => typeof r === "string")) fail("requires must be a list of ids");
    if (def.setUniforms != null && typeof def.setUniforms !== "function") fail("setUniforms must be a function");
    const e = { ...def, what, glsl, uniforms, requires };
    if (what === "material") {
      if (def.type != null) {
        if (!Number.isInteger(def.type) || def.type < 1) fail("type must be a positive integer");
        if (BUILTIN_TYPES.has(def.type)) fail(`type ${def.type} is the engine's`);
        const taken = REG.find((x) => x.what === "material" && x.type === def.type);
        if (taken) fail(`type ${def.type} is taken by "${taken.id}"`);
        if (!glsl.fn) fail("a material type needs glsl.fn");
      } else if (glsl.fn) fail("glsl.fn needs a type");
      if (def.base != null && def.base !== "wash" && def.base !== "none") fail('base must be "wash" or "none"');
    } else {
      if (typeof def.kind !== "string" || !def.kind) fail("needs an op kind");
      if (BUILTIN_KINDS.has(def.kind)) fail(`kind "${def.kind}" is the engine's`);
      const taken = REG.find((x) => x.what === "mode" && x.kind === def.kind);
      if (taken) fail(`kind "${def.kind}" is taken by "${taken.id}"`);
      if (!glsl.fn) fail("a draw mode needs glsl.fn");
      if (def.blend != null && !["over", "multiply", "clip"].includes(def.blend)) fail('blend must be "over", "multiply" or "clip"');
      if (typeof def.box !== "function") fail("needs box(op, mat)");
      if (def.reach != null && typeof def.reach !== "function") fail("reach must be a function");
    }
    REG.push(Object.freeze(e));
  }
  const registerMaterial = (def) => addExtension("material", def);
  const registerMode = (def) => addExtension("mode", def);

  // Every registration, each after what it requires, otherwise by id: the same order whatever order the scripts ran in.
  function ordered() {
    const ids = new Set(REG.map((e) => e.id)), done = new Set(), out = [];
    for (const e of REG) for (const r of e.requires) if (!ids.has(r)) throw new Error(`wc-gl extension "${e.id}" requires "${r}", which is not registered (load its script first)`);
    const left = [...REG].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    while (left.length) {
      const i = left.findIndex((e) => e.requires.every((r) => done.has(r)));
      if (i < 0) throw new Error(`wc-gl extensions require each other in a circle: ${left.map((e) => e.id).join(", ")}`);
      const [e] = left.splice(i, 1);
      done.add(e.id); out.push(e);
    }
    return out;
  }
  // The part shader with every extension spliced in, and the dispatch tables drawOps uses.
  function compose() {
    const exts = ordered(), fname = (e) => "ext_" + e.id.replace(/-/g, "_");
    const typed = exts.filter((e) => e.what === "material" && e.type != null), modes = exts.filter((e) => e.what === "mode");
    const decls = exts.map((e) => [
      `// ---- extension: ${e.id}`,
      ...Object.entries(e.uniforms).map(([n, t]) => `uniform ${t} ${n};`),
      e.glsl.decl || "",
      e.what === "material" && e.type != null ? `vec3 ${fname(e)}(vec3 col, vec2 p, float d, vec2 grad, vec2 pm) {${e.glsl.fn}\n  return col;\n}` : "",
    ].filter(Boolean).join("\n")).join("\n");
    const wash = exts.filter((e) => e.glsl.wash).map((e) => `  // wash: ${e.id}${e.glsl.wash}\n`).join("");
    const base = typed.filter((e) => e.base === "none").map((e) => `    if (uMat == ${e.type}) col = ${fname(e)}(uC2, p, d, grad, p);\n    else `).join("");
    const over = typed.filter((e) => e.base !== "none").map((e) => `      if (uMat == ${e.type}) col = ${fname(e)}(col, p, d, grad, pm);\n`).join("");
    const modeSrc = modes.map((e, i) => `  if (uMode == ${FIRST_MODE + i}) { // ${e.kind} (${e.id})${e.glsl.fn}\n  }\n`).join("");
    const fs = FS_HEAD.replace("/*@wash*/\n", wash) + decls + FS_MAIN.replace("/*@fill-base*/", base).replace("/*@fill-over*/", over).replace("/*@modes*/", modeSrc);
    return {
      fs,
      materials: exts.filter((e) => e.what === "material"),
      modes: new Map(modes.map((e, i) => [e.kind, Object.assign({ mode: FIRST_MODE + i }, e)])),
    };
  }
  // The fragment shader as it would compile now (for tests and debugging), and the registrations in splice order.
  const fragmentSource = () => (built || compose()).fs;
  const extensions = () => ordered().map(({ id, what, type, kind }) => (what === "mode" ? { id, what, kind } : { id, what, type }));

  function create(canvas) {
    const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error("WebGL2 not available");
    const floatOK = !!gl.getExtension("EXT_color_buffer_float");

    function compile(type, src) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s);
        console.error(log + "\n" + src.split("\n").map((l, i) => i + 1 + ": " + l).join("\n"));
        throw new Error("Shader compile failed: " + log);
      }
      return s;
    }
    function program(fs) {
      const p = gl.createProgram();
      gl.attachShader(p, compile(gl.VERTEX_SHADER, VS));
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
      gl.bindAttribLocation(p, 0, "aPos");
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error("Link failed: " + gl.getProgramInfoLog(p));
      const u = {};
      const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name.replace(/\[0\]$/, "")] = gl.getUniformLocation(p, info.name); }
      return { p, u };
    }
    if (!built) built = compose();   // extensions are fixed from here on
    const X = built;
    const P = { part: program(X.fs), comp: program(FS_COMP), sprite: program(FS_SPRITE) };

    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const polyTex = gl.createTexture();
    function makeTarget(w, h, old) {
      if (old && old.w === w && old.h === h) return old;
      if (old) { gl.deleteFramebuffer(old.fb); gl.deleteTexture(old.tex); }
      const tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE7);  // scratch unit: never disturb bound inputs
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, floatOK ? gl.RGBA16F : gl.RGBA8, w, h, 0, gl.RGBA, floatOK ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      return { tex, fb, w, h, key: null };
    }
    let acc = null, cache = null;
    const target = (w, h) => (acc = makeTarget(w, h, acc));
    function uploadPolys(list) {
      const rows = list.length || 1;
      const data = new Float32Array(MAXN * rows * 2);
      list.forEach((pts, r) => {
        const n = Math.min(MAXN, pts.length);
        for (let i = 0; i < n; i++) { data[(r * MAXN + i) * 2] = pts[i][0]; data[(r * MAXN + i) * 2 + 1] = pts[i][1]; }
      });
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, polyTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, MAXN, rows, 0, gl.RG, gl.FLOAT, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    }
    const BLEND = {
      over: () => { gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA); },
      multiply: () => { gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.DST_COLOR, gl.ZERO, gl.ZERO, gl.ONE); },
      clip: () => { gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.ZERO, gl.SRC_ALPHA, gl.ZERO, gl.SRC_ALPHA); },
    };
    function bbox(pts, pad) {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
      return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
    }

    // Type-1 pool gradient (mat.grad depth, mat.gradA alpha; top -> bottom along the pool's own axis, turned by
    // mat.rot): the axis and the shape's extent along it. Off for every other op.
    function poolGradient(u, op, m) {
      if (m.type !== 1 || !op.pts || !(m.grad || m.gradA)) { gl.uniform1f(u.uGradOn, 0); return; }
      const r = m.rot || 0, ax = [-Math.sin(r), Math.cos(r)], gd = m.grad || [1, 1], ga = m.gradA || [1, 1];
      let t0 = Infinity, t1 = -Infinity;
      for (const [x, y] of op.pts) { const t = x * ax[0] + y * ax[1]; if (t < t0) t0 = t; if (t > t1) t1 = t; }
      gl.uniform1f(u.uGradOn, 1);
      gl.uniform4f(u.uGrad, gd[0], gd[1], ga[0], ga[1]);
      gl.uniform2f(u.uGradAx, ax[0], ax[1]);
      gl.uniform2f(u.uGradT, t0, t1);
    }
    // Eye op: irisR (round), irisR + irisAspect (rx / ry, same mean radius) or irisR [rx, ry], with irisTilt and
    // irisEgg (shaped; R = (rx + ry) / 2 sizes the pupil's scale and the glints), lowLine (lower lash) and lidArch.
    function eyeShape(u, op) {
      const ir = op.irisR, pair = Array.isArray(ir), asp = op.irisAspect;
      const shaped = pair || !!asp || !!op.irisTilt || !!op.irisEgg;
      const ry = pair ? ir[1] : asp ? (2 * ir) / (1 + asp) : ir, rx = pair ? ir[0] : asp ? asp * ry : ir;
      const R = shaped ? (rx + ry) / 2 : ir;
      gl.uniform1f(u.uIrisR, R);
      gl.uniform1f(u.uIrisShape, shaped ? 1 : 0);
      gl.uniform4f(u.uIrisE, rx / R, ry / R, op.irisTilt || 0, op.irisEgg || 0);
      gl.uniform1f(u.uLowLine, op.lowLine == null ? 1 : op.lowLine);
      gl.uniform1f(u.uLidArch, op.lidArch || 0);
      gl.uniform1f(u.uLowLid, Math.max(0, Math.min(1, op.lowLid || 0)));
    }
    // Draw a list of ops into framebuffer fb (already cleared or holding earlier layers).
    function drawOps(ops, world, view, fb, W, H) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.viewport(0, 0, W, H);
      gl.bindVertexArray(vao);
      const polys = [];
      for (const op of ops) if (op.pts) { op._row = polys.length; polys.push(op.pts); }
      uploadPolys(polys);
      const prog = P.part, u = prog.u;
      gl.useProgram(prog.p);
      gl.uniform3f(u.uView, view.scale, view.ox, view.oy);
      gl.uniform2f(u.uRes, W, H);
      gl.uniform1f(u.uPx, 1 / view.scale);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, polyTex);
      gl.uniform1i(u.uPoly, 1);
      world = world || [600, 600];

      for (const op of ops) {
        const m = op.mat || {};
        gl.uniform1i(u.uRow, op._row || 0);
        gl.uniform1i(u.uN, op.pts ? Math.min(MAXN, op.pts.length) : 0);
        gl.uniform1f(u.uSeed, op.seed || 1);
        const cols = (m.ramp || ["#000000", "#444444", "#888888", "#ffffff"]).map(hex);
        gl.uniform3fv(u.uC0, cols[0]); gl.uniform3fv(u.uC1, cols[1]); gl.uniform3fv(u.uC2, cols[2]); gl.uniform3fv(u.uC3, cols[3]);
        gl.uniform3fv(u.uLineCol, hex(m.line || "#4a2c1a"));
        gl.uniform1f(u.uRadius, m.radius || 30);
        gl.uniform1f(u.uFur, m.fur || 0);
        gl.uniform1f(u.uFuzz, m.fuzz || 0);
        gl.uniform1f(u.uLine, m.lineAmt || 0);
        gl.uniform1f(u.uLineW, m.type === CEL ? (m.lineW == null ? 1.5 : m.lineW) : m.lineW || 0.6);
        gl.uniform1f(u.uEdge, m.edge || 10);
        gl.uniform1f(u.uAlpha, m.alpha == null ? 1 : m.alpha);
        gl.uniform1f(u.uSoft, m.soft || 5);
        gl.uniform1f(u.uLight, m.light == null ? 0.12 : m.light);
        gl.uniform1f(u.uBottom, m.bottom || 0);
        gl.uniform1f(u.uStrokes, m.strokes || 0);
        gl.uniform1f(u.uSide, m.side || 0);
        gl.uniform1f(u.uTex, m.tex == null ? 1 : m.tex);
        gl.uniform1f(u.uFurLen, m.furLen || 1);
        gl.uniform1f(u.uRim, m.rim || 0);
        gl.uniform1f(u.uEyeRich, op.rich || 0);
        gl.uniform1f(u.uMatRot, m.rot || 0);
        poolGradient(u, op, m);
        gl.uniform1i(u.uMat, m.type || 6);
        gl.uniform2f(u.uOff, (op.off || [0, 0])[0], (op.off || [0, 0])[1]);
        gl.uniform1f(u.uAmt, op.amt == null ? 0.3 : op.amt);
        gl.uniform3fv(u.uTint, hex(op.tint || "#8a6a58"));
        gl.uniform2f(u.uW, (op.w || [1, 1])[0], (op.w || [1, 1])[1]);
        if (m.type === CEL) {                    // cel: mat.light is the light's direction (radians), mat.shadow its reach
          const la = m.light == null ? CEL_LIGHT : m.light;
          gl.uniform2f(u.uCelL, Math.cos(la), Math.sin(la));
          gl.uniform1f(u.uCelShadow, m.shadow == null ? 6 : m.shadow);
          gl.uniform1f(u.uClean, m.clean ? 1 : 0);
        }
        for (const e of X.materials) if (e.setUniforms) e.setUniforms(gl, u, m, op);
        let mode = 0, blend = "over", box;
        if (op.kind === "fill") { mode = m.type === CEL ? 7 : 0; box = bbox(op.pts, 8); }
        else if (op.kind === "shadow") { mode = 1; blend = "multiply"; box = bbox(op.pts.map(([x, y]) => [x + op.off[0], y + op.off[1]]), (m.soft || 5) + 4); }
        else if (op.kind === "clip") { mode = 2; blend = "clip"; box = [-60, -60, world[0] + 60, world[1] + 60]; }
        else if (op.kind === "outline") { mode = 3; box = bbox(op.pts, 4); }
        else if (op.kind === "stroke") { mode = 4; box = bbox(op.pts, 6); }
        else if (op.kind === "blush") { mode = 5; blend = "multiply"; box = bbox(op.pts, (m.soft || 5) + 4); }
        else if (op.kind === "halo") { mode = 11; box = bbox(op.pts, (m.soft || 5) + 4 + 2 * (m.fuzz || 0)); }
        else if (op.kind === "eye") {
          mode = 6;
          gl.uniform2f(u.uEyeC, op.c[0], op.c[1]); gl.uniform2f(u.uEyeR, op.r[0], op.r[1]);
          gl.uniform2f(u.uIrisOff, op.iris[0], op.iris[1]);
          eyeShape(u, op);
          gl.uniform1f(u.uPupilR, op.pupilR); gl.uniform1f(u.uLid, op.lid || 0);
          gl.uniform4fv(u.uGl, op.glint || [0.1, -0.35, 0.16, 0.05]);
          box = [op.c[0] - op.r[0] - 5, op.c[1] - op.r[1] - 5, op.c[0] + op.r[0] + 5, op.c[1] + op.r[1] + 5];
        } else {                                 // a registered draw mode (registerMode)
          const x = X.modes.get(op.kind);
          if (!x) throw new Error(`wc-gl: no draw mode for op kind "${op.kind}" (load the extension that registers it)`);
          mode = x.mode; blend = x.blend || "over";
          if (x.setUniforms) x.setUniforms(gl, u, m, op);
          box = x.box(op, m);
        }
        gl.uniform1i(u.uMode, mode);
        BLEND[blend]();
        gl.uniform4f(u.uBox, box[0], box[1], box[2], box[3]);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
    }
    // Composite a premultiplied accumulation texture onto the canvas (over paper unless transparent).
    function composite(T, W, H, opts) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, W, H);
      gl.disable(gl.BLEND);
      const c = P.comp;
      gl.useProgram(c.p);
      gl.uniform3f(c.u.uView, 1, 0, 0);
      gl.uniform2f(c.u.uRes, W, H);
      gl.uniform4f(c.u.uBox, 0, 0, W, H);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, T.tex);
      gl.uniform1i(c.u.uAcc, 0);
      gl.uniform3fv(c.u.uPaper, hex(opts.paper || "#ffffff"));
      gl.uniform1i(c.u.uTransparent, opts.transparent ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    function clearTo(T) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, T.fb);
      gl.viewport(0, 0, T.w, T.h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    // scene: { ops: [...], world: [w, h] }  view: { scale, ox, oy }
    function render(scene, view, opts = {}) {
      const W = canvas.width, H = canvas.height, T = target(W, H);
      clearTo(T);
      drawOps(scene.ops, scene.world, view, T.fb, W, H);
      composite(T, W, H, opts);
    }
    // Same picture, but the still layers (every op without dyn) are drawn once into a cache keyed by
    // `key`; each call copies the cache and draws only the dyn ops (eyes, lids, brows, mouth) on top.
    // Valid because no still layer drawn after a feature overlaps it. Returns true if the cache was rebuilt.
    function renderCached(scene, view, key, opts = {}) {
      const W = canvas.width, H = canvas.height, T = target(W, H);
      cache = makeTarget(W, H, cache);
      let rebuilt = false;
      if (cache.key !== key) {
        clearTo(cache);
        drawOps(scene.ops.filter((o) => !o.dyn), scene.world, view, cache.fb, W, H);
        cache.key = key;
        rebuilt = true;
      }
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, cache.fb);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, T.fb);
      gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      drawOps(scene.ops.filter((o) => o.dyn), scene.world, view, T.fb, W, H);
      composite(T, W, H, opts);
      return rebuilt;
    }
    // ---------- the rig (js/wc-rig.js): still layers drawn once into their own textures, laid over with their parts'
    // matrices; the animated features drawn every frame. A head can nod, an ear flick, at the cost of a few textured
    // quads per frame instead of the whole figure. ----------
    const sprites = new Map();
    // An op's reach in world units (its outline, its shadow's offset and softness, its fur), for a layer's texture size.
    function opBox(op) {
      const m = op.mat || {}, pad = 6 + (m.soft || 0) + 2 * (m.fuzz || 0) + 5 * (m.furLen || (m.fur ? 1 : 0)) + (op.w && !Array.isArray(op.w) ? op.w * 0.6 : 0);
      const pts = [];
      if (op.pts) for (const q of op.pts) pts.push(op.off && op.kind !== "fill" ? [q[0] + op.off[0], q[1] + op.off[1]] : q);
      const x = X.modes.get(op.kind);             // a registered mode names the points it reaches (its ends, moved by off)
      if (x && x.reach) pts.push(...x.reach(op));
      else for (const k of ["a", "b"]) if (op[k]) pts.push(op[k]);
      if (op.kind === "eye") { pts.push([op.c[0] - op.r[0], op.c[1] - op.r[1]], [op.c[0] + op.r[0], op.c[1] + op.r[1]]); }
      if (!pts.length) return null;
      const b = bbox(pts, pad);
      return b;
    }
    function spriteFor(L, view, W, H, world) {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const op of L.ops) { if (op.kind === "clip") continue; const b = opBox(op); if (!b) continue; x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]); }
      const mg = 0.25 * Math.max(W, H);
      const px0 = Math.max(-mg, Math.floor(x0 * view.scale + view.ox)), py0 = Math.max(-mg, Math.floor(y0 * view.scale + view.oy));
      const px1 = Math.min(W + mg, Math.ceil(x1 * view.scale + view.ox)), py1 = Math.min(H + mg, Math.ceil(y1 * view.scale + view.oy));
      if (!(px1 > px0 && py1 > py0)) return null;
      const w = px1 - px0, h = py1 - py0, key = `${L.key}|${view.scale}|${view.ox}|${view.oy}|${px0}|${py0}|${w}|${h}`;
      let S = sprites.get(L.id);
      if (S && S.key === key) return S;
      if (!S || S.w !== w || S.h !== h) {
        if (S) { gl.deleteFramebuffer(S.fb); gl.deleteTexture(S.tex); }
        const T = makeTarget(w, h, null);
        gl.activeTexture(gl.TEXTURE7);
        gl.bindTexture(gl.TEXTURE_2D, T.tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        S = Object.assign(T, { w, h });
        sprites.set(L.id, S);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, S.fb);
      gl.viewport(0, 0, w, h);
      const white = L.mode === "mul" ? 1 : 0;
      gl.clearColor(white, white, white, white);
      gl.clear(gl.COLOR_BUFFER_BIT);
      drawOps(L.ops, world, { scale: view.scale, ox: view.ox - px0, oy: view.oy - py0 }, S.fb, w, h);
      Object.assign(S, { key, px0, py0, rebuilt: true });
      return S;
    }
    function laySprite(S, M, view, T, W, H, mul) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, T.fb);
      gl.viewport(0, 0, W, H);
      const c = P.sprite, u = c.u;
      gl.useProgram(c.p);
      gl.bindVertexArray(vao);
      // the texture's rectangle in world units, moved by M: the quad to cover
      const k = view.scale, wx0 = (S.px0 - view.ox) / k, wy0 = (S.py0 - view.oy) / k, wx1 = wx0 + S.w / k, wy1 = wy0 + S.h / k;
      const cs = [[wx0, wy0], [wx1, wy0], [wx0, wy1], [wx1, wy1]].map(([x, y]) => [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]]);
      const b = bbox(cs, 1 / k);
      const det = M[0] * M[3] - M[1] * M[2] || 1e-9, Mi = [M[3] / det, -M[1] / det, -M[2] / det, M[0] / det, (M[2] * M[5] - M[3] * M[4]) / det, (M[1] * M[4] - M[0] * M[5]) / det];
      gl.uniform4f(u.uBox, b[0], b[1], b[2], b[3]);
      gl.uniform3f(u.uView, view.scale, view.ox, view.oy);
      gl.uniform2f(u.uRes, W, H);
      gl.uniform3f(u.uI0, Mi[0], Mi[2], Mi[4]);
      gl.uniform3f(u.uI1, Mi[1], Mi[3], Mi[5]);
      gl.uniform2f(u.uTexSize, S.w, S.h);
      gl.uniform2f(u.uTexOrigin, S.px0, S.py0);
      gl.uniform1i(u.uMul, mul ? 1 : 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, S.tex);
      gl.uniform1i(u.uTex, 0);
      (mul ? BLEND.multiply : BLEND.over)();
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    // layers: CharacterLab.wcRig.layers(scene). Returns how many still layers were drawn again (0 once everything is cached).
    function renderRig(layers, view, world, opts = {}) {
      const W = canvas.width, H = canvas.height, T = target(W, H);
      clearTo(T);
      let redrawn = 0;
      const live = new Set();
      for (const L of layers) {
        if (L.mode === "dyn") { drawOps(L.ops, world, view, T.fb, W, H); continue; }
        const S = spriteFor(L, view, W, H, world);
        if (!S) continue;
        live.add(L.id);
        if (S.rebuilt) { redrawn++; S.rebuilt = false; }
        laySprite(S, L.M, view, T, W, H, L.mode === "mul");
      }
      for (const [id, S] of sprites) if (!live.has(id)) { gl.deleteFramebuffer(S.fb); gl.deleteTexture(S.tex); sprites.delete(id); }
      composite(T, W, H, opts);
      return redrawn;
    }
    // Wait for the GPU (for timing only).
    function finish() { const px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
    return { gl, render, renderCached, renderRig, finish, canvas };
  }

  CharacterLab.wcGL = { create, hex, registerMaterial, registerMode, fragmentSource, extensions, CEL };
})();

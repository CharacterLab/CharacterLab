// The clip engine: clips move a character's face (its face params: js/wc-expressions.js) and its rig (p.pose:
// js/wc-rig.js; the parts and pivots come with the character's scene) over time. The lab plays them (js/wc-lab.js:
// the Animations panel), `npm run characterlab -- film --clip=<id>` draws them as filmstrips (anim.html). A character pack
// brings its clips through registerCharacter's `clips` and the parts they may move through its `rig` (js/lab-packs.js).
//
// A clip: { id, label, group, dur (seconds), loop (repeats; else it plays once and the face returns to rest),
//   p: { param: track | value },            face params (lid, look, smile, mouthOpen, eyes…)
//   pose: { part: { channel: track } },     rig parts (head, earL, nose…) and channels rot (degrees, + = clockwise),
//                                           dx, dy (units, + = right / down), sx, sy (scale, 1 = rest)
//   sample(t, ctx) }                         optional: any params / pose computed in code ({ p, pose }), merged over
//                                           the tracks; ctx = { dur, loop, cycle (the loop's count) }
// A track is a list of keys [[time, value, ease?], …] (seconds; ease names how the move INTO that key goes, default
// "inOut"); a string or boolean value holds until the next key (eyes: "happy"). A plain value is a constant.
//   key(t, keys)  the track's value at t;   ease.*  the easing curves;   wave(t, period, amp, phase)  a sine helper
//
// Mixing (mix): the clip over the idle layer (blink, breath): the clip's params win; pose channels add (rot, dx, dy)
// or multiply (sx, sy). A face param at its rest value (lid 0, look 0, eyes "open"…) is left out of a clip's frame, so
// the idle blink and the lab's own face show through while the clip is not using it (keepRest: true keeps them); the
// rest values are the characters' (registerCharacter's expressions.rest). Units: the character's model units.
(function () {
  const CharacterLab = (window.CharacterLab = window.CharacterLab || {});

  const GROUPS = { idle: "Idle", eyes: "Eyes", mouth: "Smile & mouth", head: "Head & gestures", ears: "Ears & nose", body: "Body", mood: "Moods" };
  // The rig parts a clip may move: every registered character's (registerCharacter's rig.parts), in order.
  const rigParts = () => [...new Set((CharacterLab.lab ? CharacterLab.lab.characters() : []).flatMap((c) => (c.rig && c.rig.parts) || []))];
  const CHANNELS = ["rot", "dx", "dy", "sx", "sy"];

  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const ease = {
    linear: (u) => u,
    in: (u) => u * u,
    out: (u) => 1 - (1 - u) * (1 - u),
    inOut: (u) => (u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u)),
    sine: (u) => 0.5 - 0.5 * Math.cos(Math.PI * u),
    outBack: (u) => { const c = 1.70158, v = u - 1; return 1 + (c + 1) * v * v * v + c * v * v; },
    inBack: (u) => { const c = 1.70158; return (c + 1) * u * u * u - c * u * u; },
    outElastic: (u) => (u <= 0 ? 0 : u >= 1 ? 1 : Math.pow(2, -10 * u) * Math.sin((u * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
    bounce: (u) => {
      const n = 7.5625, d = 2.75;
      if (u < 1 / d) return n * u * u;
      if (u < 2 / d) { u -= 1.5 / d; return n * u * u + 0.75; }
      if (u < 2.5 / d) { u -= 2.25 / d; return n * u * u + 0.9375; }
      u -= 2.625 / d; return n * u * u + 0.984375;
    },
    step: (u) => (u < 1 ? 0 : 1),
  };
  // The track's value at time t (held before the first key and after the last).
  function key(t, keys) {
    if (!Array.isArray(keys)) return keys;
    if (!keys.length) return undefined;
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      const [t1, v1, e] = keys[i];
      if (t > t1) continue;
      const [t0, v0] = keys[i - 1];
      if (typeof v0 !== "number" || typeof v1 !== "number") return t >= t1 ? v1 : v0;
      const u = t1 > t0 ? (t - t0) / (t1 - t0) : 1;
      return v0 + (v1 - v0) * (ease[e] || ease.inOut)(clamp01(u));
    }
    return keys[keys.length - 1][1];
  }
  const wave = (t, period, amp = 1, phase = 0) => amp * Math.sin(((t / period) + phase) * 2 * Math.PI);

  const clips = {};
  // Register clips (registerCharacter does, for a pack's clips). Ids are unique across every file: a second clip with the same id
  // is an error (it would silently replace the first).
  function add(list) {
    for (const c of [].concat(list)) {
      if (!c || typeof c.id !== "string" || !(c.dur > 0)) throw new Error("wcAnim.add: a clip needs an id and dur > 0: " + JSON.stringify(c && c.id));
      if (clips[c.id]) throw new Error(`wcAnim.add: the clip id "${c.id}" is taken (${clips[c.id].group}: ${clips[c.id].label})`);
      clips[c.id] = Object.assign({ label: c.id, group: "mood", loop: false }, c);
      // a clip that moves the lids blinks by itself: the idle layer's blinks pause while it plays
      clips[c.id].usesLids = Array.from({ length: 25 }, (_, i) => sample(clips[c.id], (c.dur * i) / 24).p).some((p) => p.lid != null || p.lidL != null || p.lidR != null);
    }
  }
  const isTrack = (v) => Array.isArray(v) && v.length && Array.isArray(v[0]);
  // A face param at its rest value is left out of a clip's frame, so the idle blink and the lab's own face show
  // through whenever the clip is not using it (a nod with lid 0 still blinks). A clip can keep them: keepRest: true.
  let REST = {}, restOf = -1;
  const restValues = () => {   // the characters' rest values, read again once another character registers
    const n = CharacterLab.lab ? CharacterLab.lab.characters().length : 0;
    if (n !== restOf) { REST = (CharacterLab.wcExpressions && CharacterLab.wcExpressions.rest) || {}; restOf = n; }
    return REST;
  };
  const atRest = (k, v) => { const R = restValues(); return Object.prototype.hasOwnProperty.call(R, k) && (typeof v === "number" ? Math.abs(v - R[k]) < 1e-6 : v === R[k]); };
  // A clip at time t (seconds since it started): { p, pose, done }. A loop wraps; a one-shot holds its last frame
  // (done = true once t is past its end).
  function sample(id, t) {
    const c = typeof id === "string" ? clips[id] : id;
    if (!c) return { p: {}, pose: {}, done: true };
    const cycle = c.loop ? Math.floor(t / c.dur) : 0, tt = c.loop ? t - cycle * c.dur : Math.min(t, c.dur);
    const p = {}, pose = {};
    for (const [k, v] of Object.entries(c.p || {})) { const x = isTrack(v) ? key(tt, v) : v; if (x !== undefined) p[k] = x; }
    for (const [part, chans] of Object.entries(c.pose || {})) {
      const q = {};
      for (const [ch, v] of Object.entries(chans || {})) { const x = isTrack(v) ? key(tt, v) : v; if (typeof x === "number" && isFinite(x)) q[ch] = x; }
      if (Object.keys(q).length) pose[part] = q;
    }
    if (typeof c.sample === "function") {
      const r = c.sample(tt, { dur: c.dur, loop: !!c.loop, cycle }) || {};
      Object.assign(p, r.p || {});
      for (const [part, q] of Object.entries(r.pose || {})) pose[part] = Object.assign(pose[part] || {}, q);
    }
    if (!c.keepRest) for (const k of Object.keys(p)) if (atRest(k, p[k])) delete p[k];
    return { p, pose, done: !c.loop && t >= c.dur };
  }
  // Pose b over pose a: rot, dx, dy add; sx, sy multiply.
  function addPose(a, b) {
    const out = {};
    for (const part of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
      const x = (a && a[part]) || {}, y = (b && b[part]) || {}, q = {};
      for (const ch of CHANNELS) {
        const mul = ch === "sx" || ch === "sy";
        if (x[ch] == null && y[ch] == null) continue;
        q[ch] = mul ? (x[ch] == null ? 1 : x[ch]) * (y[ch] == null ? 1 : y[ch]) : (x[ch] || 0) + (y[ch] || 0);
      }
      out[part] = q;
    }
    return out;
  }
  // Layers bottom to top ({ p, pose } each): later params win, poses add.
  function mix(...layers) {
    const p = {}; let pose = {};
    for (const L of layers) { if (!L) continue; Object.assign(p, L.p || {}); pose = addPose(pose, L.pose); }
    return { p, pose };
  }
  // The idle layer the lab plays under every clip: a blink now and then (a double one sometimes) and a slow breath.
  const BLINKS = [3.1, 4.6, 2.4, 5.2, 3.7];   // seconds between blinks, repeating
  function blinkAt(t) {
    const cyc = BLINKS.reduce((a, b) => a + b, 0), ph = ((t % cyc) + cyc) % cyc;
    let at = 0;
    for (let i = 0; i < BLINKS.length; i++) {
      at += BLINKS[i];
      const d = ph - (at - 0.2);
      const one = (x) => (x >= 0 && x < 0.2 ? Math.sin((x / 0.2) * Math.PI) : 0);
      const v = one(d) + (i === 2 ? one(d - 0.28) : 0);
      if (v) return Math.min(1, v);
    }
    return 0;
  }
  function idle(t, opts = {}) {
    const p = {}, pose = {};
    if (opts.blink !== false) { const b = blinkAt(t); if (b) p.lid = b; }
    if (opts.breathe !== false) {
      const k = Math.sin((t / 3.6) * 2 * Math.PI);
      pose.body = { sy: 1 + 0.008 * k, sx: 1 - 0.003 * k };
      pose.head = { dy: -0.35 * k };
    }
    return { p, pose };
  }
  const list = (group) => Object.values(clips).filter((c) => !group || c.group === group);

  CharacterLab.wcAnim = { GROUPS, get PARTS() { return rigParts(); }, CHANNELS, ease, key, wave, add, sample, mix, addPose, idle, blinkAt, list, clips };
})();

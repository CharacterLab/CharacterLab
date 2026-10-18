// The scenarios page (lab/scenarios.html): pick a scenario a pack registered (js/lab-scenarios.js), scrub its params,
// sweep one of them (min > max > min, sine eased), play the cast's clips, see the slots, the figures' boxes and how far
// their soles float above (or sink into) their floor, and export a filmstrip of a sweep or of the clips.
//   scenarios.html?s=<id>&<param>=<value>&t=<seconds>&sweep=<param>&overlay=0
// The page keeps its state in the address, so a link (or `npm run characterlab -- shot --url=...`) opens the same
// frame. window.__labReady is set once the first frame is drawn; window.__scenarios.strip({ src, n }) returns a
// filmstrip as a data URL, for tests.
(function () {
  const CharacterLab = window.CharacterLab, S = CharacterLab.scenarios, A = CharacterLab.wcAnim, E = CharacterLab.wcElements;
  const $ = (id) => document.getElementById(id);
  const SWEEP_SECONDS = 3, MIN_TIME = 2, CONTACT = 0.5;   // a sweep's cycle; the time slider's least length; soles within this are on the floor
  const OVERLAY = { floor: "#2a9d8f", box: "#d6336c", soles: "#e8590c" };
  const STRIP = { tileH: 240, label: 22, gap: 6, cols: 6, paper: "#f4ecdf", ink: "#2b2118", ink2: "#6b5a48" };
  const qs = new URLSearchParams(location.search);
  const state = { sc: null, p: {}, t: 0, playing: false, sweep: null, clips: {}, last: 0 };
  const glc = document.createElement("canvas"), gr = CharacterLab.wcGL.create(glc);
  const view = $("view"), g = view.getContext("2d");

  const fmt = (spec, v) => `${+v.toFixed(spec.step < 1 ? Math.min(3, Math.max(0, -Math.floor(Math.log10(spec.step)))) : 0)}${spec.unit ? ` ${spec.unit}` : ""}`;
  const showError = (e) => { const m = $("msg"); m.hidden = !e; m.textContent = e ? String(e.message || e) : ""; if (e) console.error(e); };

  // ---------- drawing ----------
  function fitView(W, H, world) {
    const scale = Math.min(W / world[0], H / world[1]);
    return { scale, ox: (W - world[0] * scale) / 2, oy: (H - world[1] * scale) / 2 };
  }
  // The member's clip as the page has it (the select overrides the scenario's), and its frame at time t.
  const withClip = (m, i) => (Object.hasOwn(state.clips, i) ? Object.assign({}, m, { clip: state.clips[i] || undefined }) : m);
  const ownCast = (q, t) => (typeof state.sc.cast === "function" ? state.sc.cast(q, t) : state.sc.cast || []).map(withClip);
  const withClips = () => Object.assign({}, state.sc, { cast: ownCast });
  const frameAt = (p, t) => S.frame(withClips(), p, t);
  function paintGL(ops, world, v, W, H, transparent) {
    if (glc.width !== W || glc.height !== H) { glc.width = W; glc.height = H; }
    gr.render({ ops, world }, v, transparent ? { transparent: true } : { paper: "#ffffff" });
  }
  function drawCast(ctx, c, v, W, H) {
    const m = c.member, at = c.place, s = v.scale * at.k;
    const mv = { scale: s, ox: v.ox + v.scale * (m.x - at.k * at.foot[0]), oy: v.oy + v.scale * at.M[5] };
    paintGL(c.scene.ops, c.scene.world || [1, 1], mv, W, H, true);
    ctx.save();
    if (m.flip) { const fx = v.ox + v.scale * m.x; ctx.translate(fx, 0); ctx.scale(-1, 1); ctx.translate(-fx, 0); }
    ctx.drawImage(glc, 0, 0);
    ctx.restore();
  }
  function drawOverlay(ctx, f, v, opts) {
    const px = (x) => v.ox + v.scale * x, py = (y) => v.oy + v.scale * y, u = opts.dpr;
    ctx.save();
    ctx.font = `600 ${11 * u}px ui-monospace, monospace`;
    if (opts.slots) for (const s of f.slots) {
      const w = s.w || 120;
      ctx.strokeStyle = OVERLAY.floor; ctx.fillStyle = OVERLAY.floor; ctx.lineWidth = 2 * u; ctx.setLineDash([6 * u, 4 * u]);
      ctx.beginPath(); ctx.moveTo(px(s.x - w / 2), py(s.y)); ctx.lineTo(px(s.x + w / 2), py(s.y)); ctx.stroke();
      ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(px(s.x), py(s.y) - 6 * u); ctx.lineTo(px(s.x), py(s.y) + 6 * u); ctx.stroke();
      ctx.fillText(s.label || s.id, px(s.x - w / 2), py(s.y) + 16 * u);
    }
    if (opts.boxes) for (const c of f.cast) {
      const [x, y, w, h] = c.place.rect;
      ctx.strokeStyle = OVERLAY.box; ctx.lineWidth = 1.5 * u; ctx.setLineDash([4 * u, 4 * u]);
      ctx.strokeRect(px(x), py(y), w * v.scale, h * v.scale);
      ctx.setLineDash([]); ctx.fillStyle = OVERLAY.box; ctx.fillText(c.member.variant, px(x), py(y) - 5 * u);
      if (c.soles != null) {
        ctx.strokeStyle = OVERLAY.soles; ctx.lineWidth = 2 * u;
        ctx.beginPath(); ctx.moveTo(px(x), py(c.soles)); ctx.lineTo(px(x + w), py(c.soles)); ctx.stroke();
      }
      if (c.gap != null) { ctx.fillStyle = OVERLAY.soles; ctx.fillText(gapText(c.gap), px(x + w) + 6 * u, py(c.soles) + 4 * u); }
    }
    ctx.restore();
  }
  const gapText = (gap) => (Math.abs(gap) < CONTACT ? "on the floor" : gap > 0 ? `${gap.toFixed(1)} u above` : `${(-gap).toFixed(1)} u below`);
  // A frame at params p and time t onto a 2D context of W x H device pixels; returns the frame (for the readout).
  function drawFrame(ctx, W, H, p, t, opts) {
    const f = frameAt(p, t), v = fitView(W, H, f.world);
    ctx.fillStyle = STRIP.paper; ctx.fillRect(0, 0, W, H);
    paintGL(f.ops, f.world, v, W, H, false);
    ctx.drawImage(glc, 0, 0);
    if (state.sc.draw) { ctx.save(); state.sc.draw(ctx, p, Object.assign({ world: f.world, t }, v)); ctx.restore(); }
    for (const c of f.cast) drawCast(ctx, c, v, W, H);
    if (f.over.length) { paintGL(f.over, f.world, v, W, H, true); ctx.drawImage(glc, 0, 0); }
    if (opts.slots || opts.boxes) drawOverlay(ctx, f, v, opts);
    return f;
  }
  function render() {
    if (!state.sc) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1), cssW = view.clientWidth || 960;
    const W = Math.round(cssW * dpr), H = Math.round((cssW * state.sc.world[1] / state.sc.world[0]) * dpr);
    if (view.width !== W || view.height !== H) { view.width = W; view.height = H; }
    try {
      const f = drawFrame(g, W, H, state.p, state.t, { slots: $("ov-slots").checked, boxes: $("ov-boxes").checked, dpr });
      readout(f);
      showError(null);
    } catch (e) { showError(e); }
  }
  function readout(f) {
    const out = $("readout");
    out.textContent = "";
    for (const c of f.cast) {
      const span = document.createElement("span"), m = c.member;
      const contact = c.gap == null ? "" : ` · ${m.slotDef.label || m.slotDef.id}: soles ${gapText(c.gap)}`;
      span.textContent = `${m.variant} · ${m.clip || "no clip"}${contact}`;
      if (c.gap != null) span.className = Math.abs(c.gap) < CONTACT ? "ok" : "";
      out.append(span);
    }
    if (!f.cast.length) out.textContent = "no cast";
  }

  // ---------- controls ----------
  function buildParams() {
    const box = $("params");
    box.textContent = "";
    for (const [name, spec] of Object.entries(state.sc.params)) {
      const row = document.createElement("div");
      row.className = "param";
      row.innerHTML = `<label></label><output></output><button class="icon-btn" aria-pressed="false" title="Sweep it min > max > min"><svg class="i"><use href="#i-sweep"/></svg><span>Sweep</span></button><input type="range">`;
      const [label, out, btn, input] = row.children;
      label.textContent = spec.label; label.htmlFor = input.id = `p-${name}`;
      Object.assign(input, { min: spec.min, max: spec.max, step: spec.step, value: state.p[name] });
      out.textContent = fmt(spec, state.p[name]);
      input.addEventListener("input", () => { stopSweep(); state.p[name] = +input.value; out.textContent = fmt(spec, +input.value); saveUrl(); render(); });
      btn.addEventListener("click", () => (state.sweep && state.sweep.name === name ? stopSweep() : startSweep(name)));
      row.dataset.param = name;
      box.append(row);
    }
    $("params-group").hidden = !Object.keys(state.sc.params).length;
  }
  function syncParam(name) {
    const row = $("params").querySelector(`[data-param="${name}"]`);
    if (!row) return;
    row.querySelector("input").value = state.p[name];
    row.querySelector("output").textContent = fmt(state.sc.params[name], state.p[name]);
  }
  function buildCast() {
    const box = $("cast");
    box.textContent = "";
    let members = [];
    try { members = S.castOf(state.sc, state.p, 0); } catch (e) { showError(e); }
    members.forEach((m, i) => {
      const vv = E.parts.flatMap((p) => p.variants).find((v) => v.id === m.variant), who = vv ? E.part(vv.part).character : null;
      const row = document.createElement("label");
      row.className = "member";
      row.innerHTML = `<span>Clip of <code></code></span><select></select>`;
      row.querySelector("code").textContent = m.variant;
      const sel = row.querySelector("select");
      sel.add(new Option("No clip", ""));
      for (const c of A.list().filter((c) => !who || c.character === who)) sel.add(new Option(`${c.label} (${c.dur}s)`, c.id));
      sel.value = Object.hasOwn(state.clips, i) ? state.clips[i] : m.clip || "";
      sel.addEventListener("change", () => { state.clips[i] = sel.value; syncTime(); render(); });
      box.append(row);
    });
  }
  const timeLength = () => {
    let d = 0;
    try { d = S.clipLength(withClips(), state.p); } catch (e) { showError(e); }
    return Math.max(MIN_TIME, d);
  };
  function syncTime() {
    const d = timeLength(), input = $("time");
    input.max = d;
    if (state.t > d) state.t = 0;
    input.value = state.t;
    $("time-out").textContent = `${state.t.toFixed(2)} s`;
  }
  function buildStripSources() {
    const sel = $("strip-src");
    sel.textContent = "";
    for (const [name, spec] of Object.entries(state.sc.params)) sel.add(new Option(`Sweep of ${spec.label}`, `sweep:${name}`));
    sel.add(new Option("The clips over time", "clip"));
  }
  function choose(id) {
    stopSweep();
    state.sc = S.get(id);
    state.clips = {};
    const given = state.sc.id === qs.get("s") ? Object.fromEntries(Object.keys(state.sc.params).map((k) => [k, qs.get(k)])) : {};
    state.p = S.params(state.sc, given);
    $("scenario").value = id;
    $("name").textContent = state.sc.label;
    $("notes").textContent = state.sc.notes || "";
    buildParams(); buildCast(); buildStripSources(); syncTime();
    $("strip-out").hidden = true;
    saveUrl();
    render();
  }
  function saveUrl() {
    if (!state.sc) return;
    const q = new URLSearchParams({ s: state.sc.id });
    for (const [k, v] of Object.entries(state.p)) q.set(k, String(+v.toFixed(4)));
    if (state.t) q.set("t", state.t.toFixed(2));
    if (state.sweep) q.set("sweep", state.sweep.name);
    if (!$("ov-slots").checked && !$("ov-boxes").checked) q.set("overlay", "0");
    history.replaceState(null, "", `?${q}`);
  }

  // ---------- play and sweep ----------
  function setPlaying(on) {
    state.playing = on;
    const b = $("play");
    b.setAttribute("aria-pressed", String(on));
    b.querySelector("use").setAttribute("href", on ? "#i-pause" : "#i-play");
    b.querySelector("span").textContent = on ? "Pause" : "Play";
    if (on) loop();
  }
  function startSweep(name) {
    state.sweep = { name, start: performance.now() };
    for (const b of $("params").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.parentElement.dataset.param === name));
    saveUrl();
    loop();
  }
  function stopSweep() {
    if (!state.sweep) return;
    state.sweep = null;
    for (const b of $("params").querySelectorAll("button")) b.setAttribute("aria-pressed", "false");
    saveUrl();
  }
  let looping = false;
  function loop() {
    if (looping) return;
    looping = true; state.last = performance.now();
    const step = (now) => {
      if (!state.playing && !state.sweep) { looping = false; return; }
      const dt = Math.min(0.1, (now - state.last) / 1000);
      state.last = now;
      if (state.playing) { const d = timeLength(); state.t = (state.t + dt) % d; $("time").value = state.t; $("time-out").textContent = `${state.t.toFixed(2)} s`; }
      if (state.sweep) { const n = state.sweep.name; state.p[n] = S.sweep(state.sc.params[n], ((now - state.sweep.start) / 1000 / SWEEP_SECONDS) % 1); syncParam(n); }
      render();
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ---------- filmstrip ----------
  // N frames of a sweep (one param from its min to its max, the rest as they are) or of the clips over time, side by
  // side in rows of up to six, each with its label: returns a canvas.
  function strip(src, n) {
    const N = Math.max(2, Math.min(24, Math.round(n) || 8)), world = state.sc.world;
    const H = STRIP.tileH, W = Math.round((H * world[0]) / world[1]), cols = Math.min(N, STRIP.cols), rows = Math.ceil(N / cols);
    const head = 30, out = document.createElement("canvas");
    out.width = cols * W + (cols + 1) * STRIP.gap;
    out.height = head + rows * (H + STRIP.label + STRIP.gap) + STRIP.gap;
    const x = out.getContext("2d"), tile = document.createElement("canvas"), tg = tile.getContext("2d");
    tile.width = W; tile.height = H;
    x.fillStyle = STRIP.paper; x.fillRect(0, 0, out.width, out.height);
    const name = src.startsWith("sweep:") ? src.slice(6) : null, spec = name && state.sc.params[name], d = timeLength();
    if (name && !spec) throw new Error(`no such param: ${name}`);
    x.fillStyle = STRIP.ink; x.font = "600 14px system-ui, sans-serif";
    x.fillText(`${state.sc.label} · ${spec ? `sweep of ${spec.label}, ${fmt(spec, spec.min)} to ${fmt(spec, spec.max)}` : `clips, 0 to ${d.toFixed(2)} s`}`, STRIP.gap, 20);
    for (let i = 0; i < N; i++) {
      const u = i / (N - 1), p = Object.assign({}, state.p), t = spec ? state.t : d * u;
      if (spec) p[name] = S.sweep(spec, u / 2);
      drawFrame(tg, W, H, p, t, { slots: $("ov-slots").checked, boxes: $("ov-boxes").checked, dpr: 1 });
      const px = STRIP.gap + (i % cols) * (W + STRIP.gap), py = head + Math.floor(i / cols) * (H + STRIP.label + STRIP.gap);
      x.fillStyle = STRIP.ink2; x.font = "11px ui-monospace, monospace";
      x.fillText(spec ? `${spec.label} ${fmt(spec, p[name])}` : `${t.toFixed(2)} s`, px + 2, py + 15);
      x.drawImage(tile, px, py + STRIP.label);
    }
    return out;
  }
  function makeStrip() {
    try {
      const src = $("strip-src").value, canvas = strip(src, +$("strip-n").value), url = canvas.toDataURL("image/png");
      $("strip-img").src = url;
      Object.assign($("strip-dl"), { href: url, download: `${state.sc.id}-${src.replace(":", "-")}.png` });
      $("strip-title").textContent = $("strip-src").selectedOptions[0].textContent;
      $("strip-out").hidden = false;
      showError(null);
    } catch (e) { showError(e); }
  }

  // ---------- start ----------
  function start() {
    const all = S.list(), sel = $("scenario");
    if (!all.length) {
      document.querySelector("main").innerHTML = '<section class="card empty" style="grid-column:1/-1"><h1 style="font:600 24px var(--serif);margin:0 0 8px">No scenarios yet</h1>'
        + '<p class="muted">A pack registers its scenarios with <code>CharacterLab.scenarios.register()</code> from one of its scripts; '
        + '<code>packs/README.md</code> shows how, and Captain Kite\'s <code>kite-rooftop.js</code> is an example.</p></section>';
      return;
    }
    const packLabel = (id) => (CharacterLab.lab.packs.find((p) => p.id === id) || { label: id }).label;
    for (const pack of [...new Set(all.map((s) => s.pack))]) {
      const og = document.createElement("optgroup");
      og.label = packLabel(pack);
      for (const s of S.list(pack)) og.append(new Option(s.label, s.id));
      sel.append(og);
    }
    sel.addEventListener("change", () => choose(sel.value));
    $("play").addEventListener("click", () => setPlaying(!state.playing));
    $("time").addEventListener("input", () => { state.t = +$("time").value; $("time-out").textContent = `${state.t.toFixed(2)} s`; saveUrl(); render(); });
    for (const id of ["ov-slots", "ov-boxes"]) $(id).addEventListener("change", () => { saveUrl(); render(); });
    $("strip-make").addEventListener("click", makeStrip);
    window.addEventListener("resize", render);
    document.addEventListener("keydown", (e) => { if (e.code === "Space" && !/^(INPUT|SELECT|BUTTON)$/.test(e.target.tagName)) { e.preventDefault(); setPlaying(!state.playing); } });
    if (qs.get("overlay") === "0") $("ov-slots").checked = $("ov-boxes").checked = false;
    choose(S.get(qs.get("s")) ? qs.get("s") : all[0].id);
    const t = +qs.get("t");
    if (t > 0) { state.t = Math.min(t, timeLength()); syncTime(); render(); }
    if (qs.get("sweep") && state.sc.params[qs.get("sweep")]) startSweep(qs.get("sweep"));
  }

  window.__scenarios = { strip: ({ src = "clip", n = 8 } = {}) => strip(src, n).toDataURL("image/png"), state, render };
  try { start(); } catch (e) { showError(e); }
  window.__labReady = true;
})();

// Character Lab: pick a part of the character, compare the reference image with the WebGL render,
// play the part's small animation. Parts, variants, renderers and animations: CharacterLab.wcElements.
(function () {
  const CharacterLab = window.CharacterLab;
  const C = CharacterLab.wcCompare, E = CharacterLab.wcElements;
  const $ = (s) => document.querySelector(s);
  // An icon: one the character's pack ships (pack.json "icons" by name, else its "icon"), else the lab's own symbol
  // of that name, else the neutral figure.
  const SVG = /^(?!.*(^|\/)\.)[\w./-]+\.svg$/;
  const sprite = (name) => !!name && /^[a-z][a-z0-9-]*$/.test(name) && !!document.getElementById("i-" + name);
  function icon(name, char) {
    const p = char && (CharacterLab.lab.packs || []).find((x) => x.id === char);
    const file = p && ((p.icons || {})[name] || (sprite(name) ? null : p.icon));
    if (file && SVG.test(file)) return `<span class="i pack-i" style="--icon: url('${p.base}${file}')"></span>`;
    return `<svg class="i"><use href="#i-${sprite(name) ? name : "figure"}"/></svg>`;
  }

  // What the character packs bring (js/lab-packs.js): the default character's (the first one that has them) zooms of
  // its whole-figure views (in each view's traced world), layer toggles and gaze; the face's presets, mouths and the
  // sliders of its continuous params (js/wc-expressions.js: [param, label, min, max], 0 is rest for each).
  const labSetting = (key) => { const c = CharacterLab.lab.firstWith("lab"); return (c && c.lab[key]) || null; };
  const ZOOMS = labSetting("zooms") || {};
  const ZOOM_NAMES = [...new Set(Object.values(ZOOMS).flatMap((z) => Object.keys(z)))];
  const EXPR = CharacterLab.wcExpressions.presets;
  const FACE_SLIDERS = CharacterLab.wcExpressions.sliders;
  const MODES = [["render", "side", "Side by side"], ["onion", "onion", "Onion"], ["diff", "diff", "Difference"], ["wipe", "wipe", "Wipe"], ["blink", "blink", "Blink"]];
  const LAYERS = labSetting("layers") || [];
  const FOLLOW = labSetting("follow") || {};

  const A = CharacterLab.wcAnim, RIG = CharacterLab.wcRig;   // js/wc-anim.js (clips), js/wc-rig.js (parts and layers)
  const st = { char: null, part: null, variant: null, view: "render", wipe: 0.5, onion: 0.5, speed: 1, playing: false,
    clip: null, clipStart: 0, idle: true, clipLoop: false, follow: false,
    expr: "custom", extra: {}, lid: 0, look: 0, lookY: 0, brow: 0, mouth: Object.keys(CharacterLab.wcExpressions.mouths)[0] || null, zoom: "full",
    layers: Object.fromEntries(LAYERS.map((l) => [l, true])) };
  const lastVariant = {};
  let cur = null, refImg = null, fit = null, gl = null, glCanvas = null, blinkOn = false;
  let loop = null, animT = 0;
  const live = $("#live"), refC = $("#ref");

  const isChar = () => !!(E.part(cur.part) || {}).whole;   // a whole figure: face params, expressions, sliders
  // the sliders and mouth buttons over the chosen expression's other params (eyes, brows, blush, tilt…: js/wc-expressions.js)
  const charParams = () => Object.assign({}, st.extra, { lid: st.lid, look: st.look, lookY: st.lookY, brow: st.brow, mouth: st.mouth, layers: st.layers });
  // A rigged figure (the front, the standing figures, the heads: js/wc-rig.js) plays the Animations panel's clips over
  // the idle layer; every other part plays its own small animation (wc-elements.js ANIM).
  let rigged = false;
  // Eyes follow the pointer: the gaze eases toward it (the eyes lead, the head turns a little after them, the ears
  // shift the other way), and back to the middle when it leaves the picture.
  let pointer = null, gaze = { x: 0, y: 0, t: null };
  // The pack says where the face's centre is, how far the gaze reaches and what the gaze moves (lab.follow).
  function followLayer(t) {
    const [cx, cy] = FOLLOW.centre || [cur.frame[2] / 2, cur.frame[3] / 3], reach = FOLLOW.reach || 70;
    const want = pointer ? { x: Math.max(-1, Math.min(1, (pointer[0] - cx) / reach)), y: Math.max(-1, Math.min(1, (pointer[1] - cy) / reach)) } : { x: 0, y: 0 };
    const dt = gaze.t == null ? 0 : Math.max(0, Math.min(0.1, t - gaze.t)), k = 1 - Math.exp(-dt * 9);
    gaze = { x: gaze.x + (want.x - gaze.x) * k, y: gaze.y + (want.y - gaze.y) * k, t, hx: (gaze.hx || 0) + (want.x - (gaze.hx || 0)) * (1 - Math.exp(-dt * 3)), hy: (gaze.hy || 0) + (want.y - (gaze.hy || 0)) * (1 - Math.exp(-dt * 3)) };
    return FOLLOW.layer ? FOLLOW.layer(gaze) : { p: { look: 1.5 * gaze.x, lookY: 1.1 * gaze.y }, pose: {} };
  }
  function animLayer(t) {
    const layers = [], playing = st.clip && A.clips[st.clip];
    if (st.idle) layers.push(A.idle(t, { blink: !(playing && playing.usesLids) }));   // a clip that blinks by itself pauses the idle blink
    if (st.follow) layers.push(followLayer(t));
    if (st.clip && A.clips[st.clip]) {
      const c = A.clips[st.clip], dt = Math.max(0, t - st.clipStart);
      const s = A.sample(c, st.clipLoop && !c.loop ? dt % c.dur : dt);
      layers.push(s);
      // a clip that ends away from rest (settle: false, e.g. falling asleep) holds its last frame until the next clip
      if (s.done && !st.clipLoop && c.settle !== false) clipEnded = true;
    }
    return A.mix(...layers);
  }
  let clipEnded = false;
  const sceneAt = (t) => {
    if (rigged && isChar() && t != null) {
      const m = animLayer(t);
      return E.build(cur, Object.assign(charParams(), m.p, { pose: m.pose }), null);
    }
    return E.build(cur, isChar() ? charParams() : {}, t);
  };

  // ---------- views ----------
  function worldBox() {
    const z = cur.kind === "trace" && ZOOMS[cur.id];
    if (z) return z[st.zoom] || z.full;
    const [, , w, h] = cur.frame, k = cur.scale || 1;   // a crop scored smaller (vv.scale): its world is frame × scale
    return [-4, -4, w * k + 8, h * k + 8];
  }
  function viewFor(canvas) {
    const z = worldBox(), k = Math.min(canvas.width / z[2], canvas.height / z[3]);
    return { scale: k, ox: -z[0] * k + (canvas.width - z[2] * k) / 2, oy: -z[1] * k + (canvas.height - z[3] * k) / 2 };
  }
  // A standing character on another sheet: the model's own world, mapped into that crop.
  const through = (v) => (cur.kind === "mapped" && fit ? { scale: v.scale * fit.s, ox: v.ox + fit.tx * v.scale, oy: v.oy + fit.ty * v.scale } : v);
  function sizeCanvases() {
    const z = worldBox(), aspect = Math.max(0.62, Math.min(2.2, z[2] / z[3]));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const c of [live, refC]) {
      c.style.aspectRatio = String(aspect);
      const w = Math.round(c.getBoundingClientRect().width * dpr);
      if (w) { const h = Math.round(w / aspect); if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } }
    }
  }

  // ---------- drawing ----------
  function drawRefInto(ctx, canvas) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (refImg) C.drawRef(ctx, refImg, viewFor(canvas));
  }
  function render(t = null) {
    sizeCanvases();
    if (!gl) { glCanvas = document.createElement("canvas"); gl = CharacterLab.wcGL.create(glCanvas); }
    glCanvas.width = live.width; glCanvas.height = live.height;
    const t0 = performance.now(), v = through(viewFor(live));
    const scene = sceneAt(t);
    if (scene) {
      // a rigged figure: each part drawn once into its own layer and laid over with its pose, the features every frame
      if (scene.rig && scene.rig.def) gl.renderRig(RIG.layers(scene), v, scene.world);
      // still layers drawn once, the features every frame; a tilt turns the still layers too
      else if (isChar() || cur.kind === "mapped") gl.renderCached(scene, v, JSON.stringify([cur.id, st.layers, isChar() ? st.extra.tilt || 0 : 0, v.scale, v.ox, v.oy, glCanvas.width, glCanvas.height]));
      else gl.render(scene, v);
    }
    const ms = performance.now() - t0;
    const ctx = live.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
    if (st.view === "blink" && blinkOn) drawRefInto(ctx, live);
    else if (scene) ctx.drawImage(glCanvas, 0, 0);
    else { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, live.width, live.height); ctx.fillStyle = "#6b5a48"; ctx.font = `600 ${Math.round(live.width / 28)}px Nunito Sans, sans-serif`; ctx.textAlign = "center"; ctx.fillText("No renderer yet: reference only", live.width / 2, live.height / 2); }
    if (refImg && scene) {
      const vr = viewFor(live);
      if (st.view === "onion") { ctx.globalAlpha = st.onion; C.drawRef(ctx, refImg, vr); ctx.globalAlpha = 1; }
      if (st.view === "diff") {
        const tmp = document.createElement("canvas"); tmp.width = live.width; tmp.height = live.height;
        const tx = tmp.getContext("2d"); tx.fillStyle = "#fff"; tx.fillRect(0, 0, tmp.width, tmp.height); C.drawRef(tx, refImg, vr);
        ctx.globalCompositeOperation = "difference"; ctx.drawImage(tmp, 0, 0); ctx.globalCompositeOperation = "source-over";
      }
      if (st.view === "wipe") {
        const x = Math.round(live.width * st.wipe);
        ctx.save(); ctx.beginPath(); ctx.rect(0, 0, x, live.height); ctx.clip(); drawRefInto(ctx, live); ctx.restore();
        ctx.fillStyle = "#b5654f"; ctx.fillRect(x - 1, 0, 2, live.height);
      }
    }
    drawRefInto(refC.getContext("2d"), refC);
    return ms;
  }

  // ---------- score (at rest, never while playing) ----------
  let scoreT = null;
  const scheduleScore = () => { clearTimeout(scoreT); scoreT = setTimeout(score, 220); };
  function score() {
    if (!refImg || st.playing) return;
    const scene = RIG.flatten(sceneAt(null));
    if (!scene) { $("#score").innerHTML = `<p class="muted">No renderer for this variant yet: compare it with the image by eye.</p>`; return; }
    const SS = 3, g = document.createElement("canvas"); g.width = C.FW * SS; g.height = C.FH * SS;
    const r = CharacterLab.wcGL.create(g);
    r.render(scene, cur.kind === "mapped" && fit ? { scale: SS * fit.s, ox: SS * fit.tx, oy: SS * fit.ty } : { scale: SS, ox: 0, oy: 0 });
    const ours = C.figureCanvas((x) => { x.imageSmoothingQuality = "high"; x.drawImage(g, 0, 0, C.FW, C.FH); });
    const ref = C.figureCanvas((x) => C.drawRef(x, refImg, { scale: 1, ox: 0, oy: 0 }));
    const lose = r.gl.getExtension("WEBGL_lose_context");
    const s = cur.kind === "trace" ? C.score(ours, ref) : C.scoreElement(ours, ref);
    if (lose) lose.loseContext();
    const cell = (val, good, bad, fmt) => { const k = Math.max(0, Math.min(1, (val - bad) / (good - bad))); return `<td style="color:hsl(${Math.round(k * 120)},45%,32%)">${fmt(val)}</td>`; };
    const ratio = (val) => cell(1 - Math.abs(Math.log(val)), 1, 0.4, () => "×" + val.toFixed(2));
    let html = `<div class="kpis"><span><b>${s.fidelity}</b> fidelity</span><span><b>${(s.iou * 100).toFixed(1)}%</b> silhouette</span>`;
    if (cur.kind === "trace") {
      html += `<span><b>${Math.round(s.landmarks * 100)}%</b> landmarks</span><span><b>${s.ssim.toFixed(3)}</b> SSIM</span></div><table><tr><th></th><th>ΔE¼</th><th>SSIM</th><th>contrast</th><th>edges</th></tr>`;
      for (const [name, q] of Object.entries(s.regions)) html += `<tr><th>${name}</th>${cell(q.dE4, 5, 20, (x) => x.toFixed(1))}${cell(q.ssim, 0.7, 0.1, (x) => x.toFixed(2))}${ratio(q.contrast)}${ratio(q.edges)}</tr>`;
      html += `</table>`;
    } else {
      html += `<span><b>${s.dE4.toFixed(1)}</b> colour ΔE</span><span><b>${s.ssim.toFixed(3)}</b> SSIM</span></div><table><tr><th></th><th>contrast</th><th>edges</th></tr><tr><th>texture</th>${ratio(s.contrast)}${ratio(s.edges)}</tr></table>`;
    }
    html += displayCheck();
    $("#score").innerHTML = html;
    window.__wcScore = s;
  }

  // The score above compares at the painting's own pixels. This one compares exactly what is on screen:
  // our render at the panel's size beside the painting enlarged to it (wc-display-score.js).
  function displayCheck() {
    if (!CharacterLab.wcDisplayScore || !glCanvas || !refImg) return "";
    const W = live.width, H = live.height;
    const ours = document.createElement("canvas"); ours.width = W; ours.height = H;
    ours.getContext("2d").drawImage(glCanvas, 0, 0);
    const ref = document.createElement("canvas"); ref.width = W; ref.height = H;
    const x = ref.getContext("2d"); x.imageSmoothingQuality = "high"; drawRefInto(x, ref);
    const d = CharacterLab.wcDisplayScore.measure(ours, ref);
    return `<p class="sub-h">At this size (${W}×${H})</p><div class="kpis"><span><b>${d.ssim.toFixed(3)}</b> SSIM</span><span><b>${d.gmsd.toFixed(3)}</b> GMSD</span></div>`;
  }

  // ---------- animation ----------
  function setPlaying(on) {
    st.playing = on;
    for (const b of [$("#play"), $("#play2")]) {
      b.setAttribute("aria-pressed", String(on));
      b.querySelector("use").setAttribute("href", on ? "#i-pause" : "#i-play");
      const lab = b.querySelector("span"); if (lab) lab.textContent = on ? "Pause" : b.id === "play" ? "Animate" : "Play";
    }
    if (loop) { cancelAnimationFrame(loop); loop = null; }
    if (!on) { st.clip = null; syncClips(); $("#stat").textContent = "at rest"; render(null); scheduleScore(); return; }
    let last = performance.now(), fps = 60;
    const step = (now) => {
      const dt = Math.min(100, now - last); last = now;
      animT += (dt / 1000) * st.speed;
      fps = fps * 0.9 + (1000 / Math.max(dt, 1)) * 0.1;
      if (!document.hidden) { const ms = render(animT); $("#stat").textContent = `${Math.round(fps)} fps · ${ms.toFixed(1)} ms`; }
      if (clipEnded) { clipEnded = false; st.clip = null; syncClips(); if (!st.idle && !st.follow) { setPlaying(false); return; } }
      loop = requestAnimationFrame(step);
    };
    loop = requestAnimationFrame(step);
  }

  // ---------- the Animations panel ----------
  function playClip(id) {
    if (!rigged) return;
    st.clip = id; st.clipStart = animT; clipEnded = false;
    syncClips();
    if (!st.playing) setPlaying(true);
  }
  function syncClips() {
    document.querySelectorAll("#clips button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.clip === st.clip)));
    const c = st.clip && A.clips[st.clip];
    $("#clip-now").textContent = c ? `Playing: ${c.label}${c.loop || st.clipLoop ? " (loops)" : ""}` : rigged ? "Pick a clip. Idle keeps blinking and breathing between clips." : "Animations play on the whole figure (front, standing figures).";
  }

  // ---------- characters: the part tiles and the title follow the chosen character ----------
  function showCharacter(id) {
    st.char = id;
    const c = E.characters.find((x) => x.id === id) || E.characters[0], parts = $("#parts");
    parts.textContent = "";
    for (const p of E.partsOf(c.id)) {
      const b = document.createElement("button");
      b.className = "tile"; b.dataset.part = p.id; b.title = p.label;
      b.innerHTML = icon(p.icon, c.id) + `<span>${p.label}</span>`;
      b.addEventListener("click", () => select(p.id));
      parts.appendChild(b);
    }
    document.querySelectorAll("#chars button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.char === c.id)));
    $("#char-name").textContent = c.label;
    document.title = `Character Lab · ${c.label}`;
  }

  // ---------- selection ----------
  const sheetImgs = {};
  const loadSheet = (key) => (sheetImgs[key] = sheetImgs[key] || new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = E.sheetUrl(key); }));
  function select(partId, variantId) {
    const part = E.part(partId) || E.parts[0];
    if (part.character !== st.char) showCharacter(part.character);
    cur = E.variant(part.id, variantId || lastVariant[part.id]);
    st.part = part.id; st.variant = cur.id; lastVariant[part.id] = cur.id;
    C.setTrace(E.trace(cur));
    refImg = null; fit = null;
    rigged = !!(part.whole && cur.build && (() => { const s = cur.build({}); return s && s.rig && s.rig.def; })());
    if (!rigged) st.clip = null;
    if (cur.kind !== "trace") st.zoom = "full";
    try { const u = new URL(location.href); u.searchParams.set("char", part.character); u.searchParams.set("part", part.id); u.searchParams.set("v", cur.id); u.searchParams.delete("style"); u.searchParams.delete("el"); history.replaceState(null, "", u); } catch (e) {}
    syncUI();
    render(st.playing ? animT : null);
    C.loadRef().then((img) => { refImg = img; if (cur.kind === "mapped") fit = C.fitFor(refImg, cur); render(st.playing ? animT : null); scheduleScore(); })
      .catch(() => { $("#score").textContent = "Reference sheet not found: is its pack (or the folder lab.config.json mounts for it) there? Serve with npm start."; });
  }
  function syncUI() {
    const part = E.part(st.part);
    document.querySelectorAll("#parts .tile").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.part === st.part)));
    $("#crumb-icon").innerHTML = icon(part.icon, part.character);
    $("#part-name").textContent = part.label;
    $("#variant-name").textContent = cur.label;
    $("#ref-title").textContent = E.sheetName(cur);
    $("#live-title").textContent = cur.build ? "live, drawn in code" : "no renderer yet";
    $("#anim-label").textContent = E.animLabel(cur) || "No motion for this part";
    $("#note").textContent = cur.kind === "mapped" ? "The model is fitted to this sheet's figure: the same code, scaled and placed on the sheet's pose." : "";
    // variant tiles: the sheet crops themselves
    const box = $("#variants");
    if (box.dataset.part !== part.id) {
      box.dataset.part = part.id;
      box.innerHTML = "";
      for (const vv of part.variants) {
        const b = document.createElement("button");
        b.className = "thumb" + (vv.build ? "" : " ref-only"); b.dataset.v = vv.id; b.title = vv.label;
        const c = document.createElement("canvas"); c.width = 120; c.height = 120;
        b.appendChild(c); b.appendChild(document.createTextNode(vv.label));
        b.addEventListener("click", () => select(part.id, vv.id));
        box.appendChild(b);
        loadSheet(vv.sheet).then((img) => {
          const [x0, y0, w, h] = vv.frame, k = Math.min(112 / w, 112 / h), x = c.getContext("2d");
          x.fillStyle = "#fff"; x.fillRect(0, 0, 120, 120);
          x.imageSmoothingQuality = "high"; x.drawImage(img, x0, y0, w, h, (120 - w * k) / 2, (120 - h * k) / 2, w * k, h * k);
        }).catch(() => {});
      }
    }
    box.querySelectorAll(".thumb").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === cur.id)));
    $("#variant-count").textContent = `${part.variants.indexOf(cur) + 1} / ${part.variants.length}`;
    document.querySelectorAll("#modes .tile").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === st.view)));
    $("#wipe-row").style.display = st.view === "wipe" ? "" : "none";
    $("#onion-row").style.display = st.view === "onion" ? "" : "none";
    $("#char-controls").hidden = !isChar();
    $("#clips-box").hidden = !isChar();
    $("#idle").checked = st.idle; $("#clip-loop").checked = st.clipLoop; $("#follow").checked = st.follow;
    syncClips();
    $("#zoom-box").hidden = !(cur.kind === "trace" && ZOOMS[cur.id]);
    $("#layers-box").hidden = !LAYERS.length;
    $("#mouth-box").hidden = !Object.keys(CharacterLab.wcExpressions.mouths).length;
    document.querySelectorAll("#expr button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.expr === st.expr)));
    document.querySelectorAll("#mouths button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mouth === st.mouth)));
    document.querySelectorAll("#zooms button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.zoom === st.zoom)));
    document.querySelectorAll("#layers input").forEach((el) => (el.checked = st.layers[el.dataset.layer]));
    for (const k of ["wipe", "onion", "speed", "lid", "look", "brow"]) {
      $("#" + k).value = st[k];
      $("#v-" + k).textContent = (+st[k]).toFixed(2);
    }
    for (const [k] of FACE_SLIDERS) { const v = +(st.extra[k] || 0); $("#fs-" + k).value = v; $("#v-fs-" + k).textContent = v.toFixed(2); }
  }
  const refresh = () => { syncUI(); if (!st.playing) { render(null); scheduleScore(); } };
  function step(dir) {
    const part = E.part(st.part), i = part.variants.indexOf(cur);
    select(part.id, part.variants[(i + dir + part.variants.length) % part.variants.length].id);
  }

  // ---------- sidebar ----------
  function setSidebar(open) {
    $("#app").classList.toggle("closed", !open);
    $("#sidebar-toggle").setAttribute("aria-expanded", String(open));
    try { localStorage.setItem("character-lab-sidebar", open ? "open" : "closed"); } catch (e) {}
    requestAnimationFrame(() => render(st.playing ? animT : null));
  }

  // No character packs: the lab says where they come from instead of drawing.
  function empty() {
    document.title = "Character Lab · no characters";
    $("#char-name").textContent = "No characters";
    $("#part-name").textContent = "No character packs found";
    $("#note").innerHTML = "No character packs found; see <code>packs/README.md</code> (a pack folder with a <code>pack.json</code>, " +
      "in the lab's <code>packs/</code>, or in a folder named by <code>lab.config.json</code> or <code>LAB_PACKS</code>), " +
      "or <a href=\"new.html\">start a new character</a> from a picture.";
    for (const id of ["play", "play2"]) $("#" + id).disabled = true;
    $("#score").textContent = "–";
    $("#app").classList.add("closed"); $("#sidebar-toggle").disabled = true;   // nothing to control
  }
  function init() {
    if (!E.parts.length) return empty();
    // characters, compare modes, character controls (the part tiles follow the character: showCharacter)
    const chars = $("#chars");
    chars.hidden = E.characters.length < 2;
    for (const c of E.characters) {
      const b = document.createElement("button"); b.dataset.char = c.id;
      const own = (CharacterLab.lab.packs || []).find((x) => x.id === c.id);
      if (own && own.icon) b.innerHTML = icon(c.icon, c.id);   // the pack's own icon beside its name
      b.append(c.label);
      b.addEventListener("click", () => { if (c.id !== st.char) select(E.partsOf(c.id)[0].id); });
      chars.appendChild(b);
    }
    const modes = $("#modes");
    for (const [id, ic, label] of MODES) {
      const b = document.createElement("button");
      b.className = "tile"; b.dataset.mode = id; b.title = label;
      b.innerHTML = icon(ic) + `<span>${label}</span>`;
      b.addEventListener("click", () => { st.view = id; refresh(); });
      modes.appendChild(b);
    }
    const ex = $("#expr");
    for (const [id, e] of Object.entries(EXPR)) {
      const b = document.createElement("button"); b.textContent = e.label; b.dataset.expr = id;
      b.addEventListener("click", () => {
        const { lid = 0, look = 0, lookY = 0, brow = 0, mouth = Object.keys(CharacterLab.wcExpressions.mouths)[0] || null, ...extra } = e.p;
        Object.assign(st, { lid, look, lookY, brow, mouth, extra, expr: id }); refresh();
      });
      ex.appendChild(b);
    }
    const zs = $("#zooms");
    for (const z of ZOOM_NAMES) {
      const b = document.createElement("button"); b.textContent = z[0].toUpperCase() + z.slice(1); b.dataset.zoom = z;
      b.addEventListener("click", () => { st.zoom = z; refresh(); });
      zs.appendChild(b);
    }
    const ly = $("#layers");
    for (const l of LAYERS) {
      const lab = document.createElement("label");
      lab.innerHTML = `<input type="checkbox" data-layer="${l}"> ${l[0].toUpperCase() + l.slice(1)}`;
      lab.querySelector("input").addEventListener("change", (e) => { st.layers[l] = e.target.checked; refresh(); });
      ly.appendChild(lab);
    }
    for (const [id, label] of Object.entries(CharacterLab.wcExpressions.mouths)) {
      const b = document.createElement("button"); b.textContent = label; b.dataset.mouth = id;
      b.addEventListener("click", () => { st.mouth = id; st.expr = "custom"; refresh(); });
      $("#mouths").append(b);
    }
    // the Animations panel: the clips of js/anim/, by group (js/wc-anim.js)
    const box = $("#clips");
    for (const [g, label] of Object.entries(A.GROUPS)) {
      const list = A.list(g);
      if (!list.length) continue;
      const h = document.createElement("p"); h.className = "sub-h"; h.textContent = label; box.append(h);
      const chips = document.createElement("div"); chips.className = "chips";
      for (const c of list) {
        const b = document.createElement("button"); b.textContent = c.label; b.dataset.clip = c.id; b.title = `${c.id} · ${c.dur}s${c.loop ? " · loops" : ""}`;
        b.addEventListener("click", () => playClip(c.id));
        chips.append(b);
      }
      box.append(chips);
    }
    $("#idle").addEventListener("change", (e) => { st.idle = e.target.checked; if (!st.idle && !st.clip && st.playing) setPlaying(false); else if (st.idle && !st.playing && rigged) setPlaying(true); });
    $("#clip-loop").addEventListener("change", (e) => { st.clipLoop = e.target.checked; });
    $("#follow").addEventListener("change", (e) => { st.follow = e.target.checked; if (st.follow && !st.playing && rigged) setPlaying(true); });
    // the pointer over the live picture, in the model's world (through a mapped figure's fit)
    live.addEventListener("pointermove", (e) => {
      const r = live.getBoundingClientRect(), v = through(viewFor(live)), sx = live.width / r.width;
      pointer = [((e.clientX - r.left) * sx - v.ox) / v.scale, ((e.clientY - r.top) * sx - v.oy) / v.scale];
    });
    live.addEventListener("pointerleave", () => { pointer = null; });
    // the continuous face sliders write into the expression's params (st.extra), over the chosen preset
    for (const [k, label, min, max] of FACE_SLIDERS) {
      const row = document.createElement("div"); row.className = "row";
      row.innerHTML = `<label for="fs-${k}">${label}</label><input id="fs-${k}" type="range" min="${min}" max="${max}" step="0.01"><output id="v-fs-${k}"></output>`;
      row.querySelector("input").addEventListener("input", (e) => {
        const v = +e.target.value, extra = Object.assign({}, st.extra);
        if (v) extra[k] = v; else delete extra[k];
        st.extra = extra; st.expr = "custom"; refresh();
      });
      $("#face-sliders").append(row);
    }
    for (const k of ["wipe", "onion", "speed", "lid", "look", "brow"]) {
      $("#" + k).addEventListener("input", (e) => { st[k] = +e.target.value; if (["lid", "look", "brow"].includes(k)) st.expr = "custom"; refresh(); });
    }
    for (const b of [$("#play"), $("#play2")]) b.addEventListener("click", () => setPlaying(!st.playing));
    $("#sidebar-toggle").addEventListener("click", () => setSidebar($("#app").classList.contains("closed")));
    // drag to wipe
    let dragging = false;
    const wipeAt = (e) => { const r = live.getBoundingClientRect(); st.wipe = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); refresh(); };
    live.addEventListener("pointerdown", (e) => { if (st.view !== "wipe") return; dragging = true; wipeAt(e); });
    window.addEventListener("pointermove", (e) => { if (dragging) wipeAt(e); });
    window.addEventListener("pointerup", () => (dragging = false));
    setInterval(() => { if (st.view === "blink" && !document.hidden) { blinkOn = !blinkOn; if (!st.playing) render(null); } }, 700);
    let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => render(st.playing ? animT : null), 150); });
    window.addEventListener("keydown", (e) => {
      if (e.target.closest && e.target.closest("input, select, textarea")) return;
      if (e.key === "ArrowRight") { step(1); e.preventDefault(); }
      else if (e.key === "ArrowLeft") { step(-1); e.preventDefault(); }
      else if (e.key === " " && !(e.target.closest && e.target.closest("button"))) { setPlaying(!st.playing); e.preventDefault(); }
    });
    // start: the sidebar as last left (closed by default on small screens), then the part in the URL
    let side = null;
    try { side = localStorage.getItem("character-lab-sidebar"); } catch (e) {}
    setSidebar(side ? side === "open" : window.innerWidth > 980);
    const q = new URLSearchParams(location.search);
    const firstOf = (c) => (E.partsOf(c)[0] || E.parts[0]).id;
    const whole = E.parts.find((p) => p.whole) || E.parts[0];   // ?pose=front|side (old links): a view of the default whole figure
    const want = q.get("part") ? [q.get("part"), q.get("v")] : q.get("char") ? [firstOf(q.get("char"))] : q.get("pose") ? [whole.id, q.get("pose")] : [E.parts[0].id];
    select(want[0], want[1]);
    $("#stat").textContent = "at rest";
  }

  CharacterLab.wcLab = { init, state: st, render, select, setPlaying };
})();

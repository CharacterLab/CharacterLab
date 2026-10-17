// Face params: the plumbing between the studio (its expression buttons, mouth buttons and sliders), the clips
// (js/wc-anim.js) and a character's face. A character pack brings its face through registerCharacter's `expressions`
// (js/lab-packs.js): named presets of face params, the mouth shapes its face can draw, the sliders of its continuous
// params, the params' rest values, and build(p), the whole figure with those params. Which params a face reads is the
// pack's business; the studio's own sliders are lid, look, lookY, brow and mouth.
//   CharacterLab.wcExpressions.presets / mouths / sliders / rest   the default character's (the first one with expressions)
//   CharacterLab.wcExpressions.params(name, p)   a preset's params with p over them (an unknown name: "neutral", or none)
//   CharacterLab.wcExpressions.build(p)          the default character's figure with face params p
//   CharacterLab.wcExpressions.of(id)            one character's expressions (or null)
(function () {
  const CharacterLab = (window.CharacterLab = window.CharacterLab || {});
  const NONE = Object.freeze({ presets: {}, mouths: {}, sliders: [], rest: {} });
  const of = (id) => { const c = CharacterLab.lab && CharacterLab.lab.character(id); return (c && c.expressions) || null; };
  const current = () => { const c = CharacterLab.lab && CharacterLab.lab.firstWith("expressions"); return (c && c.expressions) || NONE; };
  // Every character's rest values together: a clip leaves a param at rest out of its frame (js/wc-anim.js).
  const rest = () => Object.assign({}, ...(CharacterLab.lab ? CharacterLab.lab.characters() : []).map((c) => (c.expressions && c.expressions.rest) || {}));

  function params(name, p = {}) {
    const presets = current().presets || {}, e = presets[name] || presets.neutral;
    return Object.assign({}, e ? e.p : {}, p);
  }
  function build(p = {}) {
    const x = current();
    if (!x.build) throw new Error("no character with a face is registered (registerCharacter's expressions.build)");
    return x.build(p);
  }

  CharacterLab.wcExpressions = {
    get presets() { return current().presets || {}; },
    get mouths() { return current().mouths || {}; },
    get sliders() { return current().sliders || []; },
    get rest() { return rest(); },
    params, build, of,
  };
})();

// The region metrics (wc-region-math.js) of a whole figure's named parts, worst first: where the drawing is furthest
// from the painting. The parts are boxes in the painting's own pixels that the pack gives its variant (vv.regions).
(function () {
  const CharacterLab = (window.CharacterLab = window.CharacterLab || {});


  // ours, ref: canvases of the figure at the painting's size. Returns [{ name, box, ...metrics }] worst first.
  function measureAll(ours, ref, regions) {
    const w = ref.width, h = ref.height;
    const a = ours.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    const b = ref.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    return Object.entries(regions)
      .map(([name, box]) => Object.assign({ name, box }, CharacterLab.wcRegionMath.measure(a, b, w, h, box)))
      .sort((p, q) => p.score - q.score);
  }

  CharacterLab.wcRegions = { measureAll };
})();

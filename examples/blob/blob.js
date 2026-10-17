(function () {
  const CL = window.CharacterLab;
  const { ellipse } = CL.lab.geom;
  const INK = "#281e28";
  const cel = (base, shade) => ({ type: 8, ramp: [shade, shade, base, base], line: INK, lineW: 3, shadow: 14, clean: true });
  // Draw in sheet pixels; the variant's crop maps them onto the scored frame.
  function build(p = {}) {
    const blink = p.eyes === "closed" ? 0.1 : 1;
    return {
      world: [512, 512],
      ops: [
        { kind: "fill", pts: [[0, 0], [512, 0], [512, 512], [0, 512]], mat: { type: 8, ramp: Array(4).fill("#eef0f3"), lineW: 0, shadow: 0, clean: true }, seed: 1 },
        { kind: "fill", pts: ellipse(256, 256, 120, 120), mat: cel("#ff8a1f", "#d0661a"), seed: 2 },
        { kind: "fill", pts: ellipse(221, 240, 15, 20 * blink), mat: cel(INK, INK), seed: 3 },
        { kind: "fill", pts: ellipse(291, 240, 15, 20 * blink), mat: cel(INK, INK), seed: 4 },
      ],
    };
  }
  CL.lab.registerCharacter({
    id: "blob", label: "Blob",
    sheetsBase: "/packs/blob/sheets/",
    sheets: { "blob-front": { file: "front.png", name: "blob front sheet" } },
    parts: [{
      id: "blob", label: "Whole", whole: true,
      variants: [{ id: "blob-front", label: "Front", sheet: "blob-front", kind: "mapped",
        frame: [96, 96, 320, 320], scale: 1, fit: { s: 1, tx: -96, ty: -96 }, build }],
    }],
  });
})();

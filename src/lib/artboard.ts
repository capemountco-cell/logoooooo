// Concept images on the grey artboard (pure, DOM-free). Image models draw on white; blending the
// whole image onto grey (multiply) darkened every logo colour by ~14%. Instead only the white
// background becomes grey: near-white, low-chroma pixels move to the artboard colour with a soft
// ramp for anti-aliased edges, and every logo colour stays exactly as drawn.
export function whiteToArtboard(rgba: Uint8ClampedArray, grey: [number, number, number], from = 226, to = 250): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba);
  for (let i = 0; i < out.length; i += 4) {
    const r = out[i]!, g = out[i + 1]!, b = out[i + 2]!;
    const min = Math.min(r, g, b), max = Math.max(r, g, b);
    if (min <= from || max - min > 18) continue; // a logo colour: untouched
    const w = Math.min(1, (min - from) / (to - from));
    out[i] = Math.round(r + (grey[0] - r) * w);
    out[i + 1] = Math.round(g + (grey[1] - g) * w);
    out[i + 2] = Math.round(b + (grey[2] - b) * w);
  }
  return out;
}

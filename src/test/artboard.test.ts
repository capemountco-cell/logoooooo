import { describe, expect, it } from "vitest";
import { whiteToArtboard } from "@/lib/artboard";

describe("concept tiles on the grey artboard", () => {
  it("turns only the white background grey and keeps logo colours exact", () => {
    const px = new Uint8ClampedArray([255, 255, 255, 255, 250, 180, 200, 255, 20, 45, 110, 255, 240, 240, 240, 255, 255, 235, 120, 255]);
    const out = whiteToArtboard(px, [220, 220, 219]);
    expect(Array.from(out.slice(0, 3))).toEqual([220, 220, 219]); // white → grey
    expect(Array.from(out.slice(4, 7))).toEqual([250, 180, 200]); // light pink stays pink
    expect(Array.from(out.slice(8, 11))).toEqual([20, 45, 110]); // navy untouched
    expect(out[12]!).toBeGreaterThan(220); // soft edge: part way
    expect(out[12]!).toBeLessThan(240);
    expect(Array.from(out.slice(16, 19))).toEqual([255, 235, 120]); // pale yellow (chromatic) untouched
  });
});

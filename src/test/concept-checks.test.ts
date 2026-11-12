import { describe, expect, it } from "vitest";
import { autoChecks, despeckle, measureConcept } from "@/lib/concept-checks";
import { normalizeBrief } from "@/lib/brief";
import { checklist } from "@/lib/concept-prompt";
import { decodePng } from "./decode-png";

/** White canvas with filled shapes, 2×2 supersampled. */
function paint(w: number, h: number, color: (x: number, y: number) => [number, number, number] | null) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const acc = [0, 0, 0];
      for (let s = 0; s < 4; s++) {
        const c = color(x + (s % 2) / 2 + 0.25, y + (s >> 1) / 2 + 0.25) ?? [255, 255, 255];
        for (let k = 0; k < 3; k++) acc[k]! += c[k]!;
      }
      const i = (y * w + x) * 4;
      out[i] = acc[0]! / 4; out[i + 1] = acc[1]! / 4; out[i + 2] = acc[2]! / 4; out[i + 3] = 255;
    }
  return out;
}

const brief = normalizeBrief({ brandName: "", logoType: "abstract", colors: [] });
const checks = checklist(brief, true);
const failed = (rgba: Uint8ClampedArray, w: number, h: number, refs: Float32Array[] = []) =>
  autoChecks(measureConcept(rgba, w, h), brief, checks, refs).filter((r) => !r.pass).map((r) => r.id);

const disc = (cx: number, cy: number, r: number) => (x: number, y: number) => (x - cx) ** 2 + (y - cy) ** 2 < r * r;

describe("concept checks", () => {
  it("passes a clean, centred, bold mark", () => {
    const img = paint(256, 256, (x, y) => (disc(128, 128, 70)(x, y) && !disc(128, 128, 30)(x, y) ? [20, 60, 140] : null));
    expect(failed(img, 256, 256)).toEqual([]);
  });

  it("passes the real logo fixtures on white", () => {
    for (const f of ["green-b-logo", "stripes-logo"]) {
      const { width, height, rgba } = decodePng(`src/test/fixtures/${f}.png`);
      const res = autoChecks(measureConcept(rgba, width, height), normalizeBrief({ colors: ["a", "b"] }), checks);
      // The stripes logo has 7 colours: more than a brief can ask for, so only that box fails.
      expect(res.filter((r) => !r.pass).map((r) => r.id)).toEqual(f === "stripes-logo" ? ["colors"] : []);
    }
  });

  it("catches a cut-off logo, a tinted background and specks", () => {
    expect(failed(paint(256, 256, (x, y) => (disc(20, 128, 60)(x, y) ? [0, 0, 0] : null)), 256, 256)).toContain("margin");
    expect(failed(paint(256, 256, (x, y) => (disc(128, 128, 60)(x, y) ? [0, 0, 0] : [235, 225, 200])), 256, 256)).toContain("background");
    const specks = paint(256, 256, (x, y) => (disc(128, 128, 60)(x, y) || (x % 37 < 1.5 && y % 41 < 1.5) ? [0, 0, 0] : null));
    expect(measureConcept(specks, 256, 256).specks).toBeGreaterThan(4);
  });

  it("catches hairline detail that vanishes when small", () => {
    // Fine 1px lines spaced apart inside a wide box.
    const img = paint(400, 400, (x, y) => (x > 60 && x < 340 && y > 60 && y < 340 && x % 9 < 1 ? [0, 0, 0] : null));
    expect(failed(img, 400, 400)).toContain("small");
  });

  it("catches designs that rely on touching colours, and too many colours", () => {
    const stripes = [[230, 30, 40], [30, 90, 220], [250, 200, 0], [20, 160, 70], [150, 40, 170]] as const;
    const img = paint(300, 300, (x, y) => (x > 50 && x < 250 && y > 50 && y < 250 ? [...stripes[Math.floor((x - 50) / 40)]!] as [number, number, number] : null));
    const ids = failed(img, 300, 300);
    expect(ids).toContain("colors");
  });

  it("flags a concept that copies a reference's shape", () => {
    const img = paint(256, 256, (x, y) => (disc(128, 128, 70)(x, y) ? [0, 0, 0] : null));
    const same = measureConcept(img, 256, 256).signature;
    expect(failed(img, 256, 256, [same])).toContain("original");
  });
});

describe("real AI output", () => {
  it("removes compression specks automatically, so a noisy concept passes", () => {
    // A clean mark plus scattered 1–3 px noise blobs, like JPEG artefacts from an image model.
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const noise = new Set(Array.from({ length: 60 }, () => `${Math.floor(rnd() * 256)},${Math.floor(rnd() * 256)}`));
    const img = paint(256, 256, (x, y) => (disc(128, 128, 60)(x, y) || noise.has(`${Math.floor(x)},${Math.floor(y)}`) ? [0, 0, 0] : null));
    const { rgba, removed } = despeckle(img, 256, 256);
    expect(removed).toBeGreaterThan(20);
    const m = measureConcept(rgba, 256, 256);
    expect(m.specks).toBe(0);
    expect(autoChecks(m, brief, checks).filter((r) => !r.pass)).toEqual([]);
  });

  it("keeps real design details like sparkles and dots", () => {
    const sparkles = [[40, 40], [210, 50], [60, 200], [200, 210]] as const;
    const img = paint(256, 256, (x, y) => (disc(128, 128, 55)(x, y) || sparkles.some(([cx, cy]) => disc(cx, cy, 5)(x, y)) ? [190, 150, 40] : null));
    const { removed } = despeckle(img, 256, 256);
    expect(removed).toBe(0);
  });

  it("only counts artwork as cut off when it reaches the edge, not when it is merely close", () => {
    const close = paint(256, 256, (x, y) => (x > 3 && x < 252 && y > 100 && y < 150 ? [0, 0, 0] : null));
    expect(failed(close, 256, 256)).not.toContain("margin");
    const cut = paint(256, 256, (x, y) => (x < 200 && y > 100 && y < 150 ? [0, 0, 0] : null));
    expect(failed(cut, 256, 256)).toContain("margin");
  });

  it("blocks only what matters; taste and tiny-size detail are notes", () => {
    const defs = checklist(normalizeBrief({ brandName: "Amuse Asylum", logoType: "combination" }), true);
    expect(defs.filter((d) => d.blocking).map((d) => d.id)).toEqual(["background", "margin", "original", "spelling", "extra_text", "type", "flat", "quality"]);
    expect(defs.filter((d) => !d.blocking).map((d) => d.id)).toEqual(["clean", "colors", "mono", "small", "brief", "references"]);
  });
});

import { describe, expect, it } from "vitest";
import { autoChecks, LIMITS, measureConcept } from "@/lib/concept-checks";
import { checklist } from "@/lib/concept-prompt";
import { normalizeBrief } from "@/lib/brief";

const W = 1024;
/** A white canvas with `paint(x, y)` deciding where dark ink goes. */
function draw(paint: (x: number, y: number) => boolean) {
  const rgba = new Uint8ClampedArray(W * W * 4).fill(255);
  for (let y = 0; y < W; y++)
    for (let x = 0; x < W; x++)
      if (paint(x, y)) {
        const i = (y * W + x) * 4;
        rgba[i] = rgba[i + 1] = rgba[i + 2] = 30;
      }
  return measureConcept(rgba, W, W);
}
const ring = (cx: number, cy: number, r: number, w: number) => (x: number, y: number) => Math.abs(Math.hypot(x - cx, y - cy) - r) <= w / 2;
const bar = (x0: number, y0: number, x1: number, y1: number) => (x: number, y: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
/** A row of letter-like strokes (vertical bars) of the given width, like a line of lettering. */
const strokes = (y0: number, h: number, w: number) => (x: number, y: number) => y >= y0 && y < y0 + h && x >= 160 && x < 860 && (x - 160) % 34 < w;

describe("stroke weight", () => {
  it("flags hairline artwork — a thin ring and thin lettering, like the 'Taut' concepts", () => {
    const thinRing = ring(512, 380, 90, 4), thinT = bar(470, 330, 554, 333), stem = bar(510, 330, 513, 440), text = strokes(560, 60, 3);
    const m = draw((x, y) => thinRing(x, y) || thinT(x, y) || stem(x, y) || text(x, y));
    expect(m.stroke).toBeLessThan(LIMITS.stroke);
  });

  it("passes sturdy artwork: a bold mark and regular-weight lettering", () => {
    const boldRing = ring(512, 380, 90, 26), t = bar(460, 330, 564, 352), stem = bar(500, 330, 524, 450), text = strokes(560, 60, 10);
    const m = draw((x, y) => boldRing(x, y) || t(x, y) || stem(x, y) || text(x, y));
    expect(m.stroke).toBeGreaterThan(LIMITS.stroke);
  });

  it("is a blocking check with a fix instruction", () => {
    const brief = normalizeBrief({ brandName: "Taut Family Orthodontics", logoType: "combination", summary: "x" });
    const checks = checklist(brief, false);
    expect(checks.find((c) => c.id === "weight")).toMatchObject({ blocking: true, by: "code" });
    const thin = draw(ring(512, 512, 150, 3));
    const r = autoChecks(thin, brief, checks).find((x) => x.id === "weight")!;
    expect(r.pass).toBe(false);
    expect(r.issue).toMatch(/twice as heavy/);
  });
});

import { describe, expect, it } from "vitest";
import { normalizeBrief } from "@/lib/brief";
import { aggregateSwatches, briefHexes, buildPalette, contrast, fromHex, industryHue, logoSwatches, nameColor, paletteToColors, rgbToHsl } from "@/lib/palette";

/** A white canvas with coloured blocks, like a reference logo thumbnail. */
function logo(blocks: { rgb: [number, number, number]; area: number }[], size = 100) {
  const out = new Uint8ClampedArray(size * size * 4).fill(255);
  let i = 0;
  for (const b of blocks) for (let k = 0; k < b.area; k++, i++) out.set([...b.rgb, 255], i * 4);
  return out;
}

const NAVY: [number, number, number] = [20, 45, 110];
const GOLD: [number, number, number] = [200, 160, 60];
const TEAL: [number, number, number] = [15, 120, 115];

describe("measured logo colours", () => {
  it("finds a logo's chromatic colours and ignores white, black and grey", () => {
    const sw = logoSwatches(logo([{ rgb: NAVY, area: 3000 }, { rgb: GOLD, area: 1000 }, { rgb: [10, 10, 10], area: 2000 }, { rgb: [128, 128, 128], area: 2000 }]), 100, 100, 1);
    expect(sw).toHaveLength(2);
    expect(sw[0]!.share).toBeCloseTo(0.75, 1);
    expect(nameColor("#142D6E")).toContain("blue");
  });

  it("ranks the hues most real logos share above a one-off", () => {
    const perLogo = [
      logoSwatches(logo([{ rgb: NAVY, area: 3000 }]), 100, 100, 1),
      logoSwatches(logo([{ rgb: [25, 50, 120], area: 2500 }, { rgb: GOLD, area: 800 }]), 100, 100, 1),
      logoSwatches(logo([{ rgb: [18, 40, 100], area: 2000 }]), 100, 100, 1),
      logoSwatches(logo([{ rgb: [220, 30, 120], area: 4000 }]), 100, 100, 1),
    ];
    const clusters = aggregateSwatches(perLogo);
    expect(clusters[0]!.logos).toBe(3);
    expect(Math.round(rgbToHsl(clusters[0]!.rgb)[0])).toBeGreaterThan(210);
  });
});

describe("palette from colour theory", () => {
  const calm = normalizeBrief({ brandName: "Hart & Lowe", industry: "family law firm", personality: ["trustworthy", "calm"], summary: "A law firm logo." });
  const bold = normalizeBrief({ brandName: "Amuse Asylum", industry: "art studio", personality: ["whimsical", "bold"], summary: "A whimsical art studio." });

  it("builds primary, accent and a readable neutral, with contrast guaranteed", () => {
    const p = buildPalette(aggregateSwatches([[{ rgb: NAVY, share: 1, hue: rgbToHsl(NAVY)[0] }]]), calm);
    expect(p.map((c) => c.role)).toEqual(["primary", "accent", "neutral"]);
    expect(contrast(fromHex(p[0]!.hex), [255, 255, 255])).toBeGreaterThanOrEqual(3);
    expect(contrast(fromHex(p[2]!.hex), [255, 255, 255])).toBeGreaterThanOrEqual(7);
  });

  it("uses an analogous accent for calm brands and a complementary one for bold brands", () => {
    const clusters = aggregateSwatches([[{ rgb: TEAL, share: 1, hue: rgbToHsl(TEAL)[0] }]]);
    const hue = (hex: string) => rgbToHsl(fromHex(hex))[0];
    const gap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
    const c = buildPalette(clusters, calm), b = buildPalette(clusters, bold);
    expect(gap(hue(c[0]!.hex), hue(c[1]!.hex))).toBeLessThan(60);
    expect(gap(hue(b[0]!.hex), hue(b[1]!.hex))).toBeGreaterThan(140);
  });

  it("prefers an accent hue real logos use near the harmony target", () => {
    // Navy logos often pair with gold: complementary target for a bold brand lands near gold.
    const clusters = aggregateSwatches([
      [{ rgb: NAVY, share: 0.8, hue: rgbToHsl(NAVY)[0] }, { rgb: GOLD, share: 0.2, hue: rgbToHsl(GOLD)[0] }],
      [{ rgb: NAVY, share: 1, hue: rgbToHsl(NAVY)[0] }],
    ]);
    const p = buildPalette(clusters, normalizeBrief({ industry: "sports cards", personality: ["bold"] }));
    expect(Math.abs(rgbToHsl(fromHex(p[1]!.hex))[0] - rgbToHsl(GOLD)[0])).toBeLessThan(10);
  });

  it("falls back to colour-psychology hues without data, and formats a lockable palette", () => {
    expect(industryHue(calm)).toBe(218);
    expect(industryHue(normalizeBrief({ industry: "sourdough bakery" }))).toBe(24);
    const colors = paletteToColors(buildPalette([], calm));
    expect(colors[0]).toMatch(/^primary .+ #[0-9A-F]{6}$/);
    expect(briefHexes(colors)).toHaveLength(3);
  });
});

describe("palette in the prompt", () => {
  it("locks a hex palette with a job for each colour, and keeps plain colour words as guidance", async () => {
    const { paletteLine } = await import("@/lib/concept-prompt");
    const locked = paletteLine(["primary deep teal #0F5C5A", "accent gold #C9A24A", "neutral charcoal #1E2422"]);
    expect(locked).toContain("use exactly these flat colours and no others");
    expect(locked).toContain("#0F5C5A — main colour for the symbol");
    expect(locked).toContain("#1E2422 — for the lettering");
    expect(paletteLine(["forest green", "cream"])).toBe("Colours: forest green, cream.");
  });
});

describe("data-led accents", () => {
  it("keeps the pairing real brands use (navy + gold) even for a calm brand, and the navy's depth", () => {
    const clusters = aggregateSwatches([
      [{ rgb: NAVY, share: 0.8, hue: rgbToHsl(NAVY)[0] }, { rgb: GOLD, share: 0.2, hue: rgbToHsl(GOLD)[0] }],
      [{ rgb: [25, 50, 125], share: 0.75, hue: rgbToHsl([25, 50, 125])[0] }, { rgb: [205, 165, 55], share: 0.25, hue: rgbToHsl([205, 165, 55])[0] }],
      [{ rgb: NAVY, share: 1, hue: rgbToHsl(NAVY)[0] }],
    ]);
    const p = buildPalette(clusters, normalizeBrief({ industry: "family law firm", personality: ["calm", "trustworthy"] }));
    expect(nameColor(p[1]!.hex)).toMatch(/gold|amber|orange/);
    expect(rgbToHsl(fromHex(p[0]!.hex))[2]).toBeLessThan(0.36);
  });
});

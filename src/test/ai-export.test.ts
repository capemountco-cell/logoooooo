import { describe, expect, it } from "vitest";
import { svgToAi } from "@/lib/ai-export";
import { toLayeredSvg, type ColorLayer } from "@/lib/color-trace";
import { reframeSvg } from "@/lib/board";
import { toSvg, type TracedPath } from "@/lib/vectorize";

const rect = (x0: number, y0: number, x1: number, y1: number): TracedPath => ({
  start: { x: x0, y: y0 },
  segments: [
    { type: "L", to: { x: x1, y: y0 } },
    { type: "C", c1: { x: x1 + 5, y: y0 }, c2: { x: x1 + 5, y: y1 }, to: { x: x1, y: y1 } },
    { type: "L", to: { x: x0, y: y1 } },
    { type: "L", to: { x: x0, y: y0 } },
  ],
});

/** Checks the PDF skeleton: every xref offset points at its object, and startxref at the xref. */
function checkStructure(pdf: string) {
  expect(pdf.startsWith("%PDF-1.4\n")).toBe(true);
  expect(pdf.endsWith("%%EOF\n")).toBe(true);
  expect([...pdf].every((c) => c === "\n" || (c >= " " && c <= "~"))).toBe(true); // ASCII: string offsets are byte offsets
  const startxref = Number(pdf.match(/startxref\n(\d+)\n%%EOF\n$/)?.[1]);
  expect(pdf.slice(startxref, startxref + 4)).toBe("xref");
  const entries = [...pdf.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  entries.forEach((offset, k) => expect(pdf.slice(offset).startsWith(`${k + 1} 0 obj\n`)).toBe(true));
  const size = Number(pdf.match(/\/Size (\d+)/)?.[1]);
  expect(size).toBe(entries.length + 1);
  // Stream lengths match their contents.
  for (const m of pdf.matchAll(/\/Length (\d+)[^\n]*\nstream\n/g)) {
    const start = m.index! + m[0].length;
    expect(pdf.slice(start + Number(m[1]), start + Number(m[1]) + 10)).toBe("\nendstream");
  }
}

describe("Illustrator (.ai) export", () => {
  it("writes a valid PDF-compatible document with the SVG's artboard and editable paths", () => {
    const svg = toSvg([rect(10, 10, 90, 50), rect(30, 20, 60, 40)], 100, 60);
    const ai = svgToAi(svg, "acme (logo)");
    checkStructure(ai);
    expect(ai).toContain("/MediaBox [0 0 1024 614]");
    expect(ai).toContain("0 0 0 rg");
    expect(ai.match(/ m\n/g)).toHaveLength(2);
    expect(ai).toContain(" c\n");
    expect(ai).toContain("f*");
    expect(ai).toContain("/Title (acme \\(logo\\))");
  });

  it("maps SVG coordinates (y down) onto the artboard (y up)", () => {
    const svg = reframeSvg(toSvg([rect(0, 0, 10, 10)], 10, 10), { x: -5, y: -5, width: 20, height: 20 }, 1300, 1200);
    const ai = svgToAi(svg);
    // 1300/20 = 65 across, 1200/20 = 60 down; origin (−5, −5) lands at the top-left corner.
    expect(ai).toContain("65 0 0 -60 325 900 cm");
    expect(ai).toContain("/MediaBox [0 0 1300 1200]");
  });

  it("keeps colours, linear and elliptical radial gradients, and fading overlays", () => {
    const layers: ColorLayer[] = [
      { paths: [rect(0, 0, 100, 100)], fill: { type: "solid", color: "#ff8000" } },
      { paths: [rect(10, 10, 50, 50)], fill: { type: "linear", x1: 10, y1: 10, x2: 50, y2: 10, stops: [{ offset: 0, color: "#000000" }, { offset: 0.5, color: "#00ff00" }, { offset: 1, color: "#ffffff" }] } },
      { paths: [rect(60, 60, 90, 90)], fill: { type: "radial", cx: 75, cy: 75, r: 15, sy: 0.5, stops: [{ offset: 0, color: "#ffffff" }, { offset: 1, color: "#0000ff" }] } },
      { paths: [rect(0, 0, 100, 100)], fill: { type: "radial", cx: 50, cy: 50, r: 40, sy: 1, stops: [{ offset: 0, color: "#ffffff", opacity: 0.6 }, { offset: 1, color: "#ffffff", opacity: 0 }] } },
    ];
    const ai = svgToAi(toLayeredSvg(layers, 100, 100));
    checkStructure(ai);
    expect(ai).toContain("1 0.502 0 rg");
    expect(ai).toContain("/ShadingType 2 /Coords [10 10 50 10]");
    expect(ai).toContain("/FunctionType 3");
    expect(ai).toContain("/Bounds [0.5]");
    expect(ai).toContain("/ShadingType 3 /Coords [75 75 0 75 75 15]");
    expect(ai).toContain("1 0 0 0.5 0 37.5 cm");
    expect(ai).toContain("/S /Luminosity");
    expect(ai).toContain("/C0 [0.6] /C1 [0]");
    expect(ai.match(/\/Sh\d+ sh/g)).toHaveLength(3);
  });
});

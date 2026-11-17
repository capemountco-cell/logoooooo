import { describe, expect, it } from "vitest";
import { rgbToCmyk, svgToEps } from "@/lib/eps-export";
import { toLayeredSvg, type ColorLayer } from "@/lib/color-trace";
import { reframeSvg } from "@/lib/board";
import { toSvg, type TracedPath } from "@/lib/vectorize";

const rect = (x0: number, y0: number, x1: number, y1: number): TracedPath => ({
  start: { x: x0, y: y0 },
  segments: [
    { type: "L", to: { x: x1, y: y0 } },
    { type: "C", c1: { x: x1 + 5, y: y0 }, c2: { x: x1 + 5, y: y1 }, to: { x: x1, y: y1 } },
    { type: "L", to: { x: x0, y: y1 } },
  ],
});

const layers: ColorLayer[] = [
  { paths: [rect(0, 0, 100, 100)], fill: { type: "solid", color: "#ff8000" } },
  { paths: [rect(10, 10, 50, 50)], fill: { type: "linear", x1: 10, y1: 10, x2: 50, y2: 10, stops: [{ offset: 0, color: "#000000" }, { offset: 0.5, color: "#00ff00" }, { offset: 1, color: "#ffffff" }] } },
  { paths: [rect(60, 60, 90, 90)], fill: { type: "radial", cx: 75, cy: 75, r: 15, sy: 0.5, stops: [{ offset: 0, color: "#ffffff" }, { offset: 1, color: "#0000ff" }] } },
  { paths: [rect(0, 0, 100, 100)], fill: { type: "radial", cx: 50, cy: 50, r: 40, sy: 1, stops: [{ offset: 0, color: "#ffffff", opacity: 0.6 }, { offset: 1, color: "#ffffff", opacity: 0 }] } },
];

describe("svgToEps", () => {
  it("writes a DSC-conforming EPS with the SVG's bounding box and editable paths", () => {
    const eps = svgToEps(toSvg([rect(0, 0, 10, 10)], 1024, 614), "acme (logo)", "cmyk");
    expect(eps.startsWith("%!PS-Adobe-3.0 EPSF-3.0\n")).toBe(true);
    expect(eps).toContain("%%BoundingBox: 0 0 1024 614\n");
    expect(eps).toContain("%%Title: acme logo\n");
    expect(eps).toContain("%%DocumentProcessColors: Cyan Magenta Yellow Black");
    expect(eps).toContain("0 0 0 1 setcmykcolor");
    expect(eps).toContain(" curveto\n");
    expect(eps).toContain("eofill");
    expect(eps.trimEnd().endsWith("%%EOF")).toBe(true);
    expect([...eps].every((c) => c === "\n" || (c >= " " && c <= "~"))).toBe(true);
  });

  it("maps SVG coordinates (y down) onto the page (y up)", () => {
    const svg = reframeSvg(toSvg([rect(0, 0, 10, 10)], 10, 10), { x: -5, y: -5, width: 20, height: 20 }, 1300, 1200);
    const eps = svgToEps(svg, "Logo", "rgb");
    expect(eps).toContain("[65 0 0 -60 325 900] concat");
    expect(eps).toContain("%%BoundingBox: 0 0 1300 1200");
  });

  it("writes CMYK for print and RGB for digital, gradients included, without transparent overlays", () => {
    const svg = toLayeredSvg(layers, 100, 100);
    const cmyk = svgToEps(svg, "Logo", "cmyk");
    expect(cmyk).toContain("0 0.498 1 0 setcmykcolor");
    expect(cmyk).toContain("/ColorSpace /DeviceCMYK");
    expect(cmyk).not.toContain("DeviceRGB");
    expect(cmyk).not.toContain("setrgbcolor");
    expect(cmyk).toContain("/C0 [0 0 0 1] /C1 [1 0 1 0]");
    expect(cmyk).toContain("/ShadingType 3 /Coords [75 75 0 75 75 15]");
    expect(cmyk).toContain("[1 0 0 0.5 0 37.5] concat");
    expect(cmyk.match(/ shfill/g)).toHaveLength(2); // the fading overlay is left out

    const rgb = svgToEps(svg, "Logo", "rgb");
    expect(rgb).toContain("1 0.502 0 setrgbcolor");
    expect(rgb).toContain("/ColorSpace /DeviceRGB");
    expect(rgb).not.toContain("CMYK");
  });

  it("converts RGB to CMYK", () => {
    expect(rgbToCmyk([0, 0, 0])).toEqual([0, 0, 0, 1]);
    expect(rgbToCmyk([1, 1, 1])).toEqual([0, 0, 0, 0]);
    expect(rgbToCmyk([1, 0, 0])).toEqual([0, 1, 1, 0]);
  });
});

// EPS export (pure, no DOM): Encapsulated PostScript 3 built from the same SVG as every other
// export, in two flavours stock sites and printers ask for — Print (CMYK, process colours) and
// Digital (RGB). Every traced outline becomes an editable path with its solid or gradient fill.
// EPS has no transparency, so soft shading overlays (gradients fading to transparent) are left
// out; the base fills underneath carry the colours.
import { parseSvg, type ViewBox } from "@/lib/outline";
import type { Fill, GradientStop } from "@/lib/color-trace";
import type { TracedPath } from "@/lib/vectorize";
import { n, rgb, spanStops } from "@/lib/ai-export";

export type EpsMode = "cmyk" | "rgb";

/** Naive device RGB → CMYK (full black generation): pure black is 0 0 0 1, white 0 0 0 0. */
export function rgbToCmyk([r, g, b]: [number, number, number]): [number, number, number, number] {
  const k = 1 - Math.max(r, g, b);
  if (k >= 1 - 1e-6) return [0, 0, 0, 1];
  const d = 1 - k;
  return [(1 - r - k) / d, (1 - g - k) / d, (1 - b - k) / d, k];
}

const colour = (hex: string, mode: EpsMode): number[] => (mode === "cmyk" ? rgbToCmyk(rgb(hex)) : rgb(hex));

function pathOps(paths: TracedPath[]) {
  const ops: string[] = [];
  for (const p of paths) {
    ops.push(`${n(p.start.x)} ${n(p.start.y)} moveto`);
    for (const s of p.segments)
      ops.push(s.type === "L" ? `${n(s.to.x)} ${n(s.to.y)} lineto` : `${n(s.c1.x)} ${n(s.c1.y)} ${n(s.c2.x)} ${n(s.c2.y)} ${n(s.to.x)} ${n(s.to.y)} curveto`);
    ops.push("closepath");
  }
  return ops.join("\n");
}

function stopFunction(stops: GradientStop[], mode: EpsMode) {
  const s = spanStops(stops);
  const pair = (a: GradientStop, b: GradientStop) =>
    `<< /FunctionType 2 /Domain [0 1] /C0 [${colour(a.color, mode).map(n).join(" ")}] /C1 [${colour(b.color, mode).map(n).join(" ")}] /N 1 >>`;
  if (s.length === 2) return pair(s[0]!, s[1]!);
  const fns: string[] = [], bounds: number[] = [];
  for (let i = 0; i < s.length - 1; i++) {
    fns.push(pair(s[i]!, s[i + 1]!));
    if (i > 0) bounds.push(Math.max(s[i]!.offset, (bounds[bounds.length - 1] ?? 0) + 1e-4));
  }
  return `<< /FunctionType 3 /Domain [0 1] /Functions [${fns.join(" ")}] /Bounds [${bounds.map(n).join(" ")}] /Encode [${fns.map(() => "0 1").join(" ")}] >>`;
}

function shading(fill: Exclude<Fill, { type: "solid" }>, mode: EpsMode) {
  const coords = fill.type === "linear"
    ? `/ShadingType 2 /Coords [${n(fill.x1)} ${n(fill.y1)} ${n(fill.x2)} ${n(fill.y2)}]`
    : `/ShadingType 3 /Coords [${n(fill.cx)} ${n(fill.cy)} 0 ${n(fill.cx)} ${n(fill.cy)} ${n(fill.r)}]`;
  const space = mode === "cmyk" ? "DeviceCMYK" : "DeviceRGB";
  return `<< ${coords} /ColorSpace /${space} /Function ${stopFunction(fill.stops, mode)} /Extend [true true] >>`;
}

const dscText = (s: string) => s.replace(/[^\x20-\x7e]/g, "").replace(/[()\\]/g, "").slice(0, 200) || "Logo";

/**
 * Converts one of this app's SVGs into an EPS (ASCII text). The bounding box matches the SVG's
 * pixel size (1 px = 1 pt), so a board export opens 1300 × 1200 with the logo centred.
 */
export function svgToEps(svg: string, title = "Logo", mode: EpsMode = "cmyk"): string {
  const { view, layers } = parseSvg(svg);
  const v: ViewBox = view ?? { x: 0, y: 0, width: 1024, height: 1024 };
  const wAttr = Number(svg.match(/^<svg\b[^>]*\swidth="([\d.]+)"/)?.[1]);
  const hAttr = Number(svg.match(/^<svg\b[^>]*\sheight="([\d.]+)"/)?.[1]);
  const W = Number.isFinite(wAttr) && wAttr > 0 ? wAttr : v.width;
  const H = Number.isFinite(hAttr) && hAttr > 0 ? hAttr : v.height;
  const sx = W / v.width, sy = H / v.height;

  const body: string[] = [];
  for (const layer of layers) {
    const fill = layer.fill;
    // EPS cannot fade to transparent: soft overlays are dropped, the base fill stays.
    if (fill.type !== "solid" && fill.stops.some((s) => (s.opacity ?? 1) < 1)) continue;
    const ops = pathOps(layer.paths);
    if (!ops) continue;
    if (fill.type === "solid") {
      const c = colour(fill.color, mode).map(n).join(" ");
      body.push(`${c} ${mode === "cmyk" ? "setcmykcolor" : "setrgbcolor"}\nnewpath\n${ops}\neofill`);
      continue;
    }
    const matrix = fill.type === "radial" && Math.abs(fill.sy - 1) > 1e-3 ? `[1 0 0 ${n(fill.sy)} 0 ${n(fill.cy * (1 - fill.sy))}] concat\n` : "";
    body.push(`gsave\nnewpath\n${ops}\neoclip\nnewpath\n${matrix}${shading(fill, mode)} shfill\ngrestore`);
  }

  const name = dscText(title);
  return [
    "%!PS-Adobe-3.0 EPSF-3.0",
    `%%BoundingBox: 0 0 ${Math.ceil(W)} ${Math.ceil(H)}`,
    `%%HiResBoundingBox: 0 0 ${n(W)} ${n(H)}`,
    `%%Title: ${name}`,
    "%%Creator: LOGOO vector export",
    "%%LanguageLevel: 3",
    mode === "cmyk" ? "%%DocumentProcessColors: Cyan Magenta Yellow Black" : "%%DocumentProcessColors: Red Green Blue",
    "%%DocumentData: Clean7Bit",
    "%%Pages: 1",
    "%%EndComments",
    "%%BeginProlog",
    "%%EndProlog",
    "%%BeginSetup",
    "%%EndSetup",
    "%%Page: 1 1",
    "gsave",
    // SVG user units, y down → PostScript points, y up.
    `[${n(sx)} 0 0 ${n(-sy)} ${n(-v.x * sx)} ${n(H + v.y * sy)}] concat`,
    ...body,
    "grestore",
    "showpage",
    "%%Trailer",
    "%%EOF",
    "",
  ].join("\n");
}

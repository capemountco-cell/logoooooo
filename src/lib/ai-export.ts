// Adobe Illustrator export (pure, no DOM). Modern .ai files are PDF-based, and Illustrator opens a
// PDF saved with the .ai extension as fully editable artwork: every traced outline becomes an
// editable path with its solid or gradient fill. Built from the same SVG the app exports, so the
// .ai always matches the SVG exactly.
import { parseSvg, type ViewBox } from "@/lib/outline";
import type { Fill, GradientStop } from "@/lib/color-trace";
import type { TracedPath } from "@/lib/vectorize";

export const n = (v: number) => {
  const r = Math.round(v * 10000) / 10000;
  return Object.is(r, -0) ? "0" : String(r);
};

export function rgb(hex: string): [number, number, number] {
  const v = /^#[0-9a-f]{6}$/i.test(hex) ? hex : "#000000";
  return [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16) / 255) as [number, number, number];
}

function pathOps(paths: TracedPath[]) {
  const ops: string[] = [];
  for (const p of paths) {
    ops.push(`${n(p.start.x)} ${n(p.start.y)} m`);
    for (const s of p.segments)
      ops.push(s.type === "L" ? `${n(s.to.x)} ${n(s.to.y)} l` : `${n(s.c1.x)} ${n(s.c1.y)} ${n(s.c2.x)} ${n(s.c2.y)} ${n(s.to.x)} ${n(s.to.y)} c`);
    ops.push("h");
  }
  return ops.join("\n");
}

/** Stops sorted, clamped to 0–1 and padded so they span the whole range. */
export function spanStops(stops: GradientStop[]) {
  const s = [...stops].map((st) => ({ ...st, offset: Math.max(0, Math.min(1, st.offset)) })).sort((a, b) => a.offset - b.offset);
  if (!s.length) return [{ offset: 0, color: "#000000" }, { offset: 1, color: "#000000" }];
  if (s[0]!.offset > 0) s.unshift({ ...s[0]!, offset: 0 });
  if (s[s.length - 1]!.offset < 1) s.push({ ...s[s.length - 1]!, offset: 1 });
  return s;
}

/** A PDF function mapping t ∈ [0, 1] to the stops' colour (rgb) or opacity (gray). */
function stopFunction(stops: GradientStop[], value: (s: GradientStop) => number[]) {
  const s = spanStops(stops);
  const pair = (a: GradientStop, b: GradientStop) =>
    `<< /FunctionType 2 /Domain [0 1] /C0 [${value(a).map(n).join(" ")}] /C1 [${value(b).map(n).join(" ")}] /N 1 >>`;
  if (s.length === 2) return pair(s[0]!, s[1]!);
  const fns: string[] = [], bounds: number[] = [];
  for (let i = 0; i < s.length - 1; i++) {
    fns.push(pair(s[i]!, s[i + 1]!));
    if (i > 0) bounds.push(Math.max(s[i]!.offset, (bounds[bounds.length - 1] ?? 0) + 1e-4));
  }
  return `<< /FunctionType 3 /Domain [0 1] /Functions [${fns.join(" ")}] /Bounds [${bounds.map(n).join(" ")}] /Encode [${fns.map(() => "0 1").join(" ")}] >>`;
}

function shading(fill: Exclude<Fill, { type: "solid" }>, space: "DeviceRGB" | "DeviceGray", fn: string) {
  const coords = fill.type === "linear"
    ? `/ShadingType 2 /Coords [${n(fill.x1)} ${n(fill.y1)} ${n(fill.x2)} ${n(fill.y2)}]`
    : `/ShadingType 3 /Coords [${n(fill.cx)} ${n(fill.cy)} 0 ${n(fill.cx)} ${n(fill.cy)} ${n(fill.r)}]`;
  return `<< ${coords} /ColorSpace /${space} /Function ${fn} /Extend [true true] >>`;
}

/** Elliptical radial gradients are scaled vertically about their centre, as in the SVG. */
const gradientMatrix = (fill: Exclude<Fill, { type: "solid" }>) =>
  fill.type === "radial" && Math.abs(fill.sy - 1) > 1e-3 ? `1 0 0 ${n(fill.sy)} 0 ${n(fill.cy * (1 - fill.sy))} cm\n` : "";

const pdfString = (s: string) => `(${s.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e]/g, "")})`;

/**
 * Converts one of this app's SVGs into a PDF-compatible Adobe Illustrator document (ASCII text).
 * The artboard matches the SVG's pixel size (1 px = 1 pt), so a board export opens on a
 * 1300 × 1200 artboard with the logo centred, exactly as the SVG shows it.
 */
export function svgToAi(svg: string, title = "Logo"): string {
  const { view, layers } = parseSvg(svg);
  const v: ViewBox = view ?? { x: 0, y: 0, width: 1024, height: 1024 };
  const wAttr = Number(svg.match(/^<svg\b[^>]*\swidth="([\d.]+)"/)?.[1]);
  const hAttr = Number(svg.match(/^<svg\b[^>]*\sheight="([\d.]+)"/)?.[1]);
  const W = Number.isFinite(wAttr) && wAttr > 0 ? wAttr : v.width;
  const H = Number.isFinite(hAttr) && hAttr > 0 ? hAttr : v.height;
  const sx = W / v.width, sy = H / v.height;

  // Objects 1–4 are fixed: catalog, pages, page, content. Shadings, masks and info follow.
  const objects: string[] = [];
  const add = (body: string) => objects.push(body) + 4;
  const shadings: string[] = [], states: string[] = [];
  // SVG user units, y down → PDF points, y up.
  const content: string[] = [`${n(sx)} 0 0 ${n(-sy)} ${n(-v.x * sx)} ${n(H + v.y * sy)} cm`];

  layers.forEach((layer, i) => {
    const ops = pathOps(layer.paths);
    if (!ops) return;
    const fill = layer.fill;
    if (fill.type === "solid") {
      content.push(`${rgb(fill.color).map(n).join(" ")} rg\n${ops}\nf*`);
      return;
    }
    const matrix = gradientMatrix(fill);
    shadings.push(`/Sh${i} ${add(shading(fill, "DeviceRGB", stopFunction(fill.stops, (s) => rgb(s.color))))} 0 R`);
    let gs = "";
    if (fill.stops.some((s) => (s.opacity ?? 1) < 1)) {
      // Fading shading overlay: a luminosity soft mask carries the stop opacities.
      const maskShading = add(shading(fill, "DeviceGray", stopFunction(fill.stops, (s) => [s.opacity ?? 1])));
      const stream = `${ops}\nW* n\n${matrix}/M0 sh`;
      const form = add(
        `<< /Type /XObject /Subtype /Form /BBox [${n(v.x)} ${n(v.y)} ${n(v.x + v.width)} ${n(v.y + v.height)}] ` +
          `/Group << /S /Transparency /CS /DeviceGray >> /Resources << /Shading << /M0 ${maskShading} 0 R >> >> /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
      );
      states.push(`/GS${i} ${add(`<< /Type /ExtGState /SMask << /Type /Mask /S /Luminosity /G ${form} 0 R >> >>`)} 0 R`);
      gs = `/GS${i} gs\n`;
    }
    content.push(`q\n${gs}${ops}\nW* n\n${matrix}/Sh${i} sh\nQ`);
  });

  const stream = content.join("\n");
  const info = add(`<< /Title ${pdfString(title)} /Creator (Logo generator) /Producer (Logo generator vector export) >>`);
  const resources = [
    shadings.length ? `/Shading << ${shadings.join(" ")} >>` : "",
    states.length ? `/ExtGState << ${states.join(" ")} >>` : "",
  ].join(" ");
  const fixed = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(W)} ${n(H)}] /ArtBox [0 0 ${n(W)} ${n(H)}] /Resources << ${resources} >> /Contents 4 0 R >>`,
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];

  // Everything is ASCII, so string offsets are byte offsets.
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  [...fixed, ...objects].forEach((body, k) => {
    offsets.push(out.length);
    out += `${k + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}

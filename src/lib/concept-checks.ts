// Automated quality checks for a generated concept (pure, DOM-free). They measure the pixels, so
// they can't be talked into a pass: clean background, nothing cut off, clean traceable shapes,
// colour count, one-colour use, legibility when small, and not copying a reference.
import { coverageFromRgba } from "@/lib/vectorize";
import { coverageSignature, matchScore } from "@/lib/logo-fidelity";
import { adviseColor } from "@/lib/color-trace";
import type { LogoBrief } from "@/lib/brief";
import type { CheckDef, CheckResult } from "@/lib/concept-prompt";

export type ConceptMetrics = {
  /** Share of border pixels that are plain near-white. */
  borderClean: number;
  /** Ink bounding box gap to the nearest image edge, as a share of the image size. */
  edgeGap: number;
  /** Artwork reaches the image edge (actually cut off, not just close). */
  touchesEdge: boolean;
  inkShare: number;
  /** Average stroke width as a share of the artwork's short side (hairlines ≈ 0.01). */
  stroke: number;
  /** Tiny isolated ink blobs still present (despeckle removes them before measuring). */
  specks: number;
  shapes: number;
  colors: number;
  /** Interior colour edges relative to the outline: high means it relies on colour to read. */
  colorReliance: number;
  /** Shape match after shrinking to icon/header size and back (1 = nothing lost). */
  smallMatch: number;
  signature: Float32Array;
};

/** Connected components of a boolean mask (8-connected, like despeckle): their sizes. */
function components(mask: Uint8Array, width: number, height: number) {
  const seen = new Uint8Array(mask.length);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || seen[s]) continue;
    let size = 0;
    seen[s] = 1;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % width, y = (i / width) | 0;
      const visit = (j: number) => { if (mask[j] && !seen[j]) { seen[j] = 1; stack.push(j); } };
      if (x > 0) visit(i - 1);
      if (x < width - 1) visit(i + 1);
      if (y > 0) { visit(i - width); if (x > 0) visit(i - width - 1); if (x < width - 1) visit(i - width + 1); }
      if (y < height - 1) { visit(i + width); if (x > 0) visit(i + width - 1); if (x < width - 1) visit(i + width + 1); }
    }
    sizes.push(size);
  }
  return sizes;
}

/** Area-average downsample of coverage so the short side is `short` px, then the signature. */
function smallSignature(coverage: Float32Array, width: number, height: number, box: { x0: number; y0: number; x1: number; y1: number }, short: number) {
  const bw = box.x1 - box.x0 + 1, bh = box.y1 - box.y0 + 1;
  const scale = Math.min(1, short / Math.min(bw, bh));
  const sw = Math.max(1, Math.round(bw * scale)), sh = Math.max(1, Math.round(bh * scale));
  const out = new Float32Array(sw * sh);
  const cnt = new Float32Array(sw * sh);
  for (let y = box.y0; y <= box.y1; y++)
    for (let x = box.x0; x <= box.x1; x++) {
      const k = Math.min(sh - 1, Math.floor((y - box.y0) * scale)) * sw + Math.min(sw - 1, Math.floor((x - box.x0) * scale));
      out[k]! += coverage[y * width + x]!;
      cnt[k]!++;
    }
  for (let k = 0; k < out.length; k++) out[k] = cnt[k] ? out[k]! / cnt[k]! : 0;
  return coverageSignature(out, sw, sh);
}

/** Clears ink blobs smaller than `tiny` from the mask and coverage; returns how many there were. */
function dropTiny(ink: Uint8Array, coverage: Float32Array, width: number, height: number, tiny: number) {
  const n = width * height;
  const seen = new Uint8Array(n);
  const stack: number[] = [];
  const blob: number[] = [];
  let dropped = 0;
  for (let s = 0; s < n; s++) {
    if (!ink[s] || seen[s]) continue;
    blob.length = 0;
    seen[s] = 1;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!;
      blob.push(i);
      const x = i % width, y = (i / width) | 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if ((dx || dy) && xx >= 0 && yy >= 0 && xx < width && yy < height) {
            const j = yy * width + xx;
            if (ink[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
          }
        }
    }
    if (blob.length < tiny) {
      dropped++;
      for (const i of blob) { ink[i] = 0; coverage[i] = 0; }
    }
  }
  return dropped;
}

/** Blobs smaller than this many pixels are compression noise, not design (≈ 30 px at 1024²). */
export const speckSize = (width: number, height: number) => Math.max(4, width * height * 0.00003);

/**
 * Removes compression noise and stray specks: isolated ink blobs below speckSize are painted
 * with the background (white, or clear on transparent images). Real design details — dots,
 * sparkles, i-dots — are bigger and stay. Returns a new image and how many blobs went.
 */
export function despeckle(rgba: Uint8ClampedArray, width: number, height: number): { rgba: Uint8ClampedArray; removed: number } {
  const coverage = coverageFromRgba(rgba, width, height);
  const n = width * height;
  const ink = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (coverage[i]! >= 0.5) ink[i] = 1;
  const tiny = speckSize(width, height);
  const out = new Uint8ClampedArray(rgba);
  let transparent = 0;
  for (let i = 3; i < out.length; i += 4) if (out[i]! < 128) transparent++;
  const clearBg = transparent > n * 0.02;
  const seen = new Uint8Array(n);
  const stack: number[] = [];
  const blob: number[] = [];
  let removed = 0;
  for (let s = 0; s < n; s++) {
    if (!ink[s] || seen[s]) continue;
    blob.length = 0;
    seen[s] = 1;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!;
      blob.push(i);
      if (blob.length > tiny) { stack.length = 0; break; } // big enough: keep, stop early
      const x = i % width, y = (i / width) | 0;
      for (const j of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, y > 0 ? i - width : -1, y < height - 1 ? i + width : -1, x > 0 && y > 0 ? i - width - 1 : -1, x < width - 1 && y > 0 ? i - width + 1 : -1, x > 0 && y < height - 1 ? i + width - 1 : -1, x < width - 1 && y < height - 1 ? i + width + 1 : -1]) {
        if (j >= 0 && ink[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
      }
    }
    if (blob.length > tiny) {
      // Mark the rest of this large blob as seen so it isn't re-walked piece by piece.
      const rest = [s];
      while (rest.length) {
        const i = rest.pop()!;
        const x = i % width, y = (i / width) | 0;
        for (const j of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, y > 0 ? i - width : -1, y < height - 1 ? i + width : -1]) {
          if (j >= 0 && ink[j] && seen[j] !== 2) { seen[j] = 2; rest.push(j); }
        }
      }
      continue;
    }
    removed++;
    // Paint the blob and its soft 1px fringe with the background.
    for (const i of blob) {
      const x = i % width, y = (i / width) | 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
          const k = (yy * width + xx) * 4;
          if (clearBg) out[k + 3] = 0;
          else { out[k] = 255; out[k + 1] = 255; out[k + 2] = 255; out[k + 3] = 255; }
        }
    }
  }
  return { rgba: out, removed };
}

/** Measures a concept (pass it despeckled: see despeckle). */
export function measureConcept(rgba: Uint8ClampedArray, width: number, height: number): ConceptMetrics {
  const n = width * height;
  // Generated concepts are asked for on white, so the background is judged against white.
  let clean = 0, border = 0;
  const band = Math.max(2, Math.round(Math.min(width, height) * 0.02));
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (x >= band && x < width - band && y >= band && y < height - band) continue;
      const i = (y * width + x) * 4;
      border++;
      const a = rgba[i + 3]! / 255;
      const v = [0, 1, 2].map((c) => rgba[i + c]! * a + 255 * (1 - a));
      if (v.every((c) => c >= 232) && Math.max(...v) - Math.min(...v) < 14) clean++;
    }
  const coverage = coverageFromRgba(rgba, width, height);
  const ink = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (coverage[i]! >= 0.5) ink[i] = 1;
  // Noise-sized blobs never count as artwork: they can't move the edges, size or small-size
  // legibility (re-measuring a cleaned image can surface new faint ones).
  const tiny = speckSize(width, height);
  const specks = dropTiny(ink, coverage, width, height, tiny);
  let x0 = width, y0 = height, x1 = -1, y1 = -1, inkCount = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (ink[i]) {
        inkCount++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  const empty = x1 < 0;
  const edgeGap = empty ? 0 : Math.min(x0 / width, y0 / height, (width - 1 - x1) / width, (height - 1 - y1) / height);
  // Cut off = artwork reaches the outermost pixels. Close to the edge is fine: every export is
  // re-centred on its board with an even margin.
  const edge = Math.max(1, Math.round(Math.min(width, height) * 0.003));
  const touchesEdge = !empty && (x0 < edge || y0 < edge || x1 >= width - edge || y1 >= height - edge);
  // Specks: isolated ink blobs under 0.002% of the image (≈ 20 px at 1024²). Holes are never
  // counted: tiny counters belong to small lettering, which the small-size check judges.
  const inkParts = components(ink, width, height);
  // Colour reliance: ink pixels whose colour jumps against ink 2 px away, vs outline pixels.
  let interior = 0, outline = 0;
  const step = 2;
  for (let y = step; y < height - step; y += 1)
    for (let x = step; x < width - step; x += 1) {
      const i = y * width + x;
      const right = i + step, down = i + step * width;
      for (const j of [right, down]) {
        if (ink[i] !== ink[j]) outline++;
        else if (ink[i] && coverage[i]! > 0.9 && coverage[j]! > 0.9) {
          const a = i * 4, b = j * 4;
          const d = Math.abs(rgba[a]! - rgba[b]!) + Math.abs(rgba[a + 1]! - rgba[b + 1]!) + Math.abs(rgba[a + 2]! - rgba[b + 2]!);
          if (d > 90) interior++;
        }
      }
    }
  const signature = coverageSignature(coverage, width, height);
  const box = empty ? { x0: 0, y0: 0, x1: width - 1, y1: height - 1 } : { x0, y0, x1, y1 };
  // Legibility is judged on the solid ink shape: soft shading near the ink threshold would
  // otherwise flip pixels when shrunk and fail simple, bold marks.
  const solid = new Float32Array(n);
  for (let i = 0; i < n; i++) solid[i] = ink[i]!;
  const solidSignature = coverageSignature(solid, width, height);
  // Small: the logo's short side at 48 px — a header logo or app icon (32 px favicons are a
  // separate simplified mark, not something a full logo must survive).
  const smallMatch = empty ? 0 : matchScore(solidSignature, smallSignature(solid, width, height, box, 48));
  // Stroke weight: the average stroke width (2 × ink area ÷ ink outline, which is the width of a
  // strip) relative to the artwork's short side. Hairline rings and thin type sit near 1%; sturdy
  // logos well above 3%.
  let boundary = 0;
  for (let y = 1; y < height - 1; y++)
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      if (ink[i] && (!ink[i - 1] || !ink[i + 1] || !ink[i - width] || !ink[i + width])) boundary++;
    }
  const shortSide = empty ? 1 : Math.max(1, Math.min(x1 - x0 + 1, y1 - y0 + 1));
  const stroke = boundary ? (2 * inkCount) / boundary / shortSide : 0;
  const advice = adviseColor(rgba, width, height);
  return {
    stroke,
    borderClean: border ? clean / border : 0,
    edgeGap,
    touchesEdge,
    inkShare: inkCount / n,
    specks,
    shapes: inkParts.filter((s) => s >= tiny).length,
    colors: advice.colors,
    colorReliance: outline ? interior / outline : 0,
    smallMatch,
    signature,
  };
}

/** Thresholds, tuned on the real logo fixtures (see concept-checks.test.ts). */
export const LIMITS = {
  borderClean: 0.97,
  minInk: 0.004,
  maxInk: 0.75,
  specks: 4,
  shapes: 400,
  colorReliance: 0.6,
  smallMatch: 0.6,
  /** Average stroke width under this share of the artwork's short side reads as hairline. */
  stroke: 0.018,
  copy: 0.82,
} as const;

/**
 * Colours allowed: what the brief lists plus two (lettering and a tonal shade), never fewer than
 * 4 — tonal shades of one hue are a legitimate design, not colour noise.
 */
export function colorLimit(brief: LogoBrief) {
  return Math.max(4, brief.colors.length + 2);
}

export function autoChecks(m: ConceptMetrics, brief: LogoBrief, checks: CheckDef[], references: Float32Array[] = []): CheckResult[] {
  const out: CheckResult[] = [];
  const add = (id: CheckResult["id"], pass: boolean, issue: string) => {
    if (checks.some((c) => c.id === id)) out.push({ id, pass, issue: pass ? "" : issue });
  };
  add("background", m.borderClean >= LIMITS.borderClean, "Make the background plain pure white everywhere: remove any texture, tint, scene, frame or shadow around the logo.");
  add(
    "margin",
    !m.touchesEdge && m.inkShare >= LIMITS.minInk && m.inkShare <= LIMITS.maxInk,
    m.inkShare < LIMITS.minInk
      ? "The logo is missing or far too small: draw it clearly in the centre."
      : m.inkShare > LIMITS.maxInk
        ? "The artwork fills the whole image: make the logo smaller with plain white space around it."
        : "Part of the logo touches or is cut off by the image edge: shrink it and centre it with a clear white margin on every side.",
  );
  add("clean", m.specks <= LIMITS.specks && m.shapes <= LIMITS.shapes, m.shapes > LIMITS.shapes ? "Too many tiny separate pieces for a logo: simplify into fewer, bolder shapes." : "Remove the stray specks, dots and noise around and inside the logo; keep edges crisp and solid.");
  const limit = colorLimit(brief);
  add("colors", m.colors <= limit, `Use at most ${limit} flat colours; merge or remove the extra colours and any colour noise.`);
  add("mono", m.colorReliance <= LIMITS.colorReliance, "Parts of the design are separated only by colour, so it falls apart in one colour: separate touching coloured shapes with a clear white gap or distinct outlines.");
  add("weight", m.stroke >= LIMITS.stroke, "The lines and lettering are hairline-thin and will disappear at small sizes, in print and embroidered on a cap: make every stroke, line, ring and letter about twice as heavy (regular to bold weight), keeping the same design, layout and colours.");
  add("small", m.smallMatch >= LIMITS.smallMatch, "Too much fine detail to read at small sizes: thicken thin strokes, open up tight gaps and remove tiny details.");
  const copied = references.some((r) => matchScore(m.signature, r) >= LIMITS.copy);
  add("original", !copied, "The logo copies a reference image's shape too closely: create a clearly different, original design that only borrows the stated quality.");
  return out;
}

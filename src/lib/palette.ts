// Logo palettes (pure, DOM-free). When a brief names no colours, the palette is built from data:
// the colours real logos for the same industry and mood actually use (measured from the Brave
// reference results, not guessed), then shaped by colour theory — one primary from the most used
// hue, a second colour by a harmony suited to the personality, and a dark neutral for lettering —
// with readable contrast guaranteed. Without data it falls back to colour-psychology defaults.
import type { LogoBrief } from "@/lib/brief";

export type RGB = [number, number, number];
/** A logo's colour: average RGB of a hue family and its share of the logo's ink. */
export type Swatch = { rgb: RGB; share: number; hue: number };
export type PaletteColor = { role: "primary" | "accent" | "neutral"; hex: string; name: string };

const HUE_BIN = 20;

export function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h * 60, s, l];
}

export function hslToRgb(h: number, s: number, l: number): RGB {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

export const toHex = ([r, g, b]: RGB) => `#${[r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
export const fromHex = (h: string): RGB => { const v = parseInt(h.replace("#", ""), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };

/** WCAG relative luminance and contrast ratio. */
function luminance([r, g, b]: RGB) {
  const f = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
export function contrast(a: RGB, b: RGB) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

/**
 * The chromatic colours a logo uses: pixels grouped into hue families (white background,
 * greys and near-blacks skipped), each with its share of the logo's coloured ink.
 */
export function logoSwatches(rgba: Uint8ClampedArray, width: number, height: number, step = 2): Swatch[] {
  const bins = new Map<number, { r: number; g: number; b: number; n: number }>();
  let total = 0;
  for (let y = 0; y < height; y += step)
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      if (rgba[i + 3]! < 128) continue;
      const rgb: RGB = [rgba[i]!, rgba[i + 1]!, rgba[i + 2]!];
      const [h, s, l] = rgbToHsl(rgb);
      if (l > 0.92 || l < 0.1 || s < 0.22) continue; // background, black ink, greys
      const k = Math.floor(h / HUE_BIN);
      const bin = bins.get(k) ?? { r: 0, g: 0, b: 0, n: 0 };
      bin.r += rgb[0]; bin.g += rgb[1]; bin.b += rgb[2]; bin.n++;
      bins.set(k, bin);
      total++;
    }
  if (!total) return [];
  return [...bins.values()]
    .map((b) => { const rgb: RGB = [b.r / b.n, b.g / b.n, b.b / b.n].map(Math.round) as RGB; return { rgb, share: b.n / total, hue: rgbToHsl(rgb)[0] }; })
    .filter((s) => s.share >= 0.06)
    .sort((a, b) => b.share - a.share)
    .slice(0, 4);
}

/** A hue family seen across many logos: how many logos use it, and its average colour. */
export type HueCluster = { hue: number; rgb: RGB; logos: number; weight: number };

/** Combines swatches from many logos: hues used by more logos (and more of each) rank first. */
export function aggregateSwatches(perLogo: Swatch[][]): HueCluster[] {
  const clusters: (HueCluster & { sum: [number, number, number, number] })[] = [];
  for (const swatches of perLogo) {
    const seen = new Set<number>();
    for (const s of swatches) {
      let c = clusters.find((k) => Math.min(Math.abs(k.hue - s.hue), 360 - Math.abs(k.hue - s.hue)) < 22);
      if (!c) {
        c = { hue: s.hue, rgb: s.rgb, logos: 0, weight: 0, sum: [0, 0, 0, 0] };
        clusters.push(c);
      }
      const idx = clusters.indexOf(c);
      if (!seen.has(idx)) { c.logos++; seen.add(idx); }
      c.weight += s.share;
      c.sum[0] += s.rgb[0] * s.share; c.sum[1] += s.rgb[1] * s.share; c.sum[2] += s.rgb[2] * s.share; c.sum[3] += s.share;
      c.rgb = [c.sum[0] / c.sum[3], c.sum[1] / c.sum[3], c.sum[2] / c.sum[3]].map(Math.round) as RGB;
      c.hue = rgbToHsl(c.rgb)[0];
    }
  }
  return clusters
    .map(({ sum: _sum, ...c }) => c)
    .sort((a, b) => b.logos + b.weight - (a.logos + a.weight));
}

/** Colour-psychology starting hues by industry keyword, used when no reference data loads. */
const INDUSTRY_HUES: [RegExp, number][] = [
  [/law|legal|attorney|finance|bank|invest|wealth|insur|account|consult|capital|trust/i, 218],
  [/health|medic|clinic|dental|care|pharma|therapy/i, 188],
  [/eco|green|garden|outdoor|hik|camp|farm|organic|nature|forest|plant|sustain/i, 138],
  [/coffee|bakery|bread|cafe|café|restaurant|food|kitchen|grill|bbq|pizza|brew/i, 24],
  [/tech|software|app|digital|data|cloud|ai\b|saas|cyber|robot/i, 232],
  [/beauty|cosmetic|salon|spa|skin|fashion|boutique|bridal|florist|flower/i, 338],
  [/kid|child|toy|school|educat|learn|play/i, 42],
  [/sport|fitness|gym|athlet|card|team|league/i, 4],
  [/real estate|property|construct|build|home|roof|plumb|electric/i, 30],
  [/travel|air|aviation|airline|flight|ocean|sea|marine|surf/i, 204],
  [/art|creative|studio|design|music|film|gallery/i, 282],
  [/luxury|jewel|gold|premium|watch|wine|spirits/i, 42],
];

/** Personalities that suit a complementary (high-contrast) pair rather than an analogous one. */
const BOLD = /bold|playful|energetic|fun|vibrant|youthful|whimsical|dynamic|loud|sporty|quirky|eccentric/i;

export function industryHue(brief: LogoBrief): number {
  const text = `${brief.industry} ${brief.summary} ${brief.brandName}`;
  return INDUSTRY_HUES.find(([re]) => re.test(text))?.[1] ?? 210;
}

const HUE_NAMES: [number, string][] = [
  [14, "red"], [34, "orange"], [52, "gold"], [68, "yellow"], [95, "olive"], [150, "green"],
  [175, "teal"], [200, "cyan"], [225, "blue"], [255, "indigo"], [285, "violet"], [320, "magenta"], [345, "rose"], [360, "red"],
];

export function nameColor(hex: string) {
  const [h, s, l] = rgbToHsl(fromHex(hex));
  if (s < 0.18) return l < 0.25 ? "charcoal" : l > 0.85 ? "off-white" : "grey";
  const hue = HUE_NAMES.find(([max]) => h < max)?.[1] ?? "red";
  return `${l < 0.3 ? "deep " : l > 0.62 ? "light " : ""}${hue}`;
}

/** Nudges a colour's lightness until it reaches `ratio` contrast against white. */
function readableOnWhite([h, s, l]: [number, number, number], ratio: number): RGB {
  let rgb = hslToRgb(h, s, l);
  for (let i = 0; i < 40 && contrast(rgb, [255, 255, 255]) < ratio; i++) { l = Math.max(0.05, l - 0.02); rgb = hslToRgb(h, s, l); }
  return rgb;
}

/**
 * A 3-colour logo palette: primary (the hue most real logos in this space use, at its measured
 * depth), accent (the colour real brands actually pair with it, when that pairing is a recognised
 * harmony; otherwise analogous for calm, refined brands and complementary for bold, playful ones,
 * nudged to a hue real logos use), and a near-black neutral tinted with the primary for lettering. Primary and neutral
 * are guaranteed readable on white (3:1 and 7:1).
 */
export function buildPalette(clusters: HueCluster[], brief: LogoBrief): PaletteColor[] {
  const top = clusters[0];
  const [ph, ps0, pl0] = top ? rgbToHsl(top.rgb) : [industryHue(brief), 0.62, 0.4];
  const ps = Math.max(0.45, Math.min(0.82, ps0));
  // Keep the measured depth (a navy stays navy), within a readable, printable range.
  const primary = readableOnWhite([ph, ps, Math.max(0.22, Math.min(0.5, pl0))], 3);
  const bold = BOLD.test(brief.personality.join(" ") + " " + brief.summary);
  const dist = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
  // A recognised harmony with the primary: analogous, triadic, split-complementary or complementary.
  const harmonious = (h: number) => { const d = dist(h, ph); return (d >= 15 && d <= 50) || (d >= 100 && d <= 140) || d >= 145; };
  // 1) What real brands pair with this primary, when it is a real pairing (≥ 2 logos) in harmony.
  const paired = clusters.slice(1).find((c) => c.logos >= 2 && harmonious(c.hue));
  // 2) Otherwise the harmony that suits the personality, nudged to a hue real logos use near it.
  const target = (ph + (bold ? 180 : 32)) % 360;
  const near = paired ?? clusters.slice(1).find((c) => dist(c.hue, target) < 40 && dist(c.hue, ph) > 18);
  const [ah, as0] = near ? rgbToHsl(near.rgb) : [target, ps];
  const accent = readableOnWhite([ah, Math.max(0.45, Math.min(0.85, as0)), near ? Math.max(0.4, Math.min(0.58, rgbToHsl(near.rgb)[2])) : bold ? 0.52 : 0.46], 2.2);
  const neutral = readableOnWhite([ph, 0.16, 0.15], 7);
  return [
    { role: "primary", hex: toHex(primary), name: nameColor(toHex(primary)) },
    { role: "accent", hex: toHex(accent), name: nameColor(toHex(accent)) },
    { role: "neutral", hex: toHex(neutral), name: nameColor(toHex(neutral)) },
  ];
}

/** The palette as brief colour entries the concept prompt locks to (e.g. "primary deep teal #0F5C5A"). */
export const paletteToColors = (p: PaletteColor[]) => p.map((c) => `${c.role} ${c.name} ${c.hex}`);

/** Hex colours in a brief's colour list (a locked palette when present). */
export const briefHexes = (colors: string[]) => colors.flatMap((c) => c.match(/#[0-9a-f]{6}\b/gi) ?? []);

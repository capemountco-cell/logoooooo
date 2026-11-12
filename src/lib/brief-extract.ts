// Reading a brief from an uploaded screenshot or document (pure, shared): how tall screenshots
// are cut into readable sections, and what the vision model is asked to transcribe.

/** Width the screenshot is scaled to before cutting; sections stay readable at the model's detail. */
export const TILE = { width: 1024, height: 1400, overlap: 96, max: 10 } as const;

export type TileRect = { y: number; height: number };

/**
 * Cuts a (scaled) screenshot of `height` px into overlapping horizontal sections, so a long
 * phone capture isn't shrunk into unreadable text. Short images stay in one piece. Very long ones
 * use taller sections rather than exceeding the section limit.
 */
export function tileRects(height: number, tile: { height: number; overlap: number; max: number } = TILE): TileRect[] {
  if (height <= tile.height * 1.15) return [{ y: 0, height }];
  let h = tile.height;
  const count = () => Math.ceil((height - tile.overlap) / (h - tile.overlap));
  while (count() > tile.max) h = Math.ceil(h * 1.15);
  const n = count();
  const step = (height - h) / (n - 1);
  return Array.from({ length: n }, (_, i) => ({ y: Math.round(i * step), height: h }));
}

export const EXTRACT_INSTRUCTIONS = [
  "You are reading a logo design brief that a client or a design platform has shared — as screenshots (in order, top to bottom, possibly overlapping) or as a document. Transcribe the brief faithfully as plain text so a designer can work from it.",
  "Include, when present: the brand or business name EXACTLY as written (same spelling, case and punctuation), any slogan or tagline to include, what the business does, its audience and industry, the style the client wants, colours (named palettes, swatches you can see, and colours to avoid), every style slider as words with its position (e.g. \"Classic ↔ Modern: strongly classic\", \"Geometric ↔ Organic: middle\"), notes from the client, what to avoid, and the deliverables.",
  "For inspiration or example images, describe in a few words the style each one shows (e.g. \"vintage circular badge, distressed texture\", \"hand-lettered script\") without inventing names or text.",
  "Ignore everything that is not the brief: the platform's own branding, navigation, buttons, timers, deadlines, prices and prize badges, user names and avatars, ratings, translation pickers, submission rules, file-format lists, legal text and footers. Do not add advice or anything that is not in the brief.",
  "Use short labelled lines (e.g. \"Name: …\", \"Industry: …\"). If something is unreadable, leave it out rather than guess.",
].join("\n\n");

/** Accepted brief uploads. Images are read through the canvas (sRGB) and cut into sections. */
export const BRIEF_FILE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,text/markdown,.md,.txt";
export const MAX_BRIEF_PDF = 15_000_000;

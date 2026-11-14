// Prompts for generating, reviewing and fixing logo concepts (pure, shared by client and server).
import { logoType, SHOWS_NAME, type LogoBrief, type ReferenceNote } from "@/lib/brief";
import { briefHexes } from "@/lib/palette";
import { planLines, type ConceptPlan } from "@/lib/concept-plan";

export type Provider = "openai" | "grok";
/** With Grok on: four concepts per round, two from each model, so the set has real variety. */
export const CONCEPT_PROVIDERS: Provider[] = ["openai", "grok", "openai", "grok"];
/**
 * Which model draws each concept in a round. Grok is off by default (live runs failed it
 * constantly): then a round is three OpenAI concepts. With the "Use Grok" setting on it is four,
 * two from each model.
 */
export function conceptProviders(useGrok: boolean): Provider[] {
  return useGrok ? CONCEPT_PROVIDERS : ["openai", "openai", "openai"];
}

/** One creative lean per concept, always inside the brief's personality. */
export const DIRECTIONS = [
  "Lean geometric and minimal: precise construction, generous negative space, very few elements.",
  "Lean bold and characterful: confident weight, a memorable signature detail, strong silhouette.",
  "Lean refined and elegant: balanced proportions, considered contrast, quiet confidence.",
  "Lean warm and organic: friendlier curves and a more human, approachable feel.",
] as const;

/** The exact text the artwork must contain, if any. */
export function requiredText(brief: LogoBrief): { name: string; tagline: string } {
  const t = brief.logoType;
  if (!brief.brandName) return { name: "", tagline: "" };
  if (t === "lettermark" || t === "letterform") return { name: "", tagline: "" };
  if (SHOWS_NAME.includes(t) || t === "mascot" || t === "line") {
    // Mascot and line marks carry the name only when the brief asks for text.
    const optional = t === "mascot" || t === "line";
    const wantsName = !optional || brief.mustHave.some((m) => /name|text|word/i.test(m));
    return { name: wantsName ? brief.brandName : "", tagline: wantsName ? brief.tagline : "" };
  }
  return { name: "", tagline: "" };
}

/** Initials for a lettermark: first letters of the words (max 3), or the first letter for a letterform. */
export function initials(brief: LogoBrief) {
  const words = brief.brandName.split(/[\s\-_&+.]+/).filter(Boolean);
  if (brief.logoType === "letterform") return Array.from(brief.brandName.trim())[0] ?? "";
  const letters = words.map((w) => Array.from(w)[0] ?? "").join("");
  return Array.from(letters).slice(0, 3).join("").toUpperCase();
}

function inventory(text: string) {
  const glyphs = Array.from(text);
  return `${glyphs.length} characters, in order: ${glyphs.map((g, i) => `${i + 1}=${JSON.stringify(g)}`).join("; ")}`;
}

/** Text rules shared by generation and fixes: exact spelling, custom lettering, nothing extra. */
function textRules(brief: LogoBrief) {
  const { name, tagline } = requiredText(brief);
  const letters = brief.logoType === "lettermark" || brief.logoType === "letterform" ? initials(brief) : "";
  const lines: string[] = [];
  if (name) {
    lines.push(
      `EXACT TEXT: The logo must contain the brand name ${JSON.stringify(name)} exactly once (${inventory(name)}). Keep its exact case, spacing and punctuation; never autocorrect, translate or change a letter. Every letter must be complete, correctly formed and clearly readable.`,
    );
    if (tagline) lines.push(`TAGLINE: Add the tagline ${JSON.stringify(tagline)} exactly once (${inventory(tagline)}), much smaller than the name, in a simple supporting style.`);
  }
  if (letters) lines.push(`EXACT LETTERS: The mark is built from the letter${Array.from(letters).length > 1 ? "s" : ""} ${JSON.stringify(letters)} only (${inventory(letters)}). Each letter must stay identifiable.`);
  if (name || letters) {
    lines.push(
      "CUSTOM LETTERING: Draw unique, custom letterforms designed for this brand — not a recognisable stock font. Give them one ownable signature detail (a custom terminal, cut, ligature, counter or stroke modification) that suits the personality, while keeping consistent stroke weight, even spacing and perfect legibility.",
    );
  }
  lines.push(name || letters ? "NO OTHER TEXT: no words, letters, numbers, slogans, labels or watermarks beyond what is specified above." : "NO TEXT: the logo contains no letters, words or numbers at all.");
  return lines;
}

const OUTPUT_RULES =
  "OUTPUT: One single logo, centred on a plain pure white (#FFFFFF) background with generous empty margin on every side (at least 12% of the image). Flat vector style: solid fills, crisp clean edges, no gradients unless the brief asks for them, no shadows, glows, textures, 3D, bevels or photo effects. No mockup, scene, paper, device, colour swatches, guides, multiple versions or presentation board.";

const DESIGN_RULES = [
  "DESIGN QUALITY: Simple, distinctive and memorable, crafted like the work of a top identity studio. It must still read clearly at 32 pixels, in a single colour, and embroidered on a cap. Balanced optical weight, consistent stroke weights and corner treatment across every element. Original: never imitate a famous existing logo.",
  "WEIGHT: no hairlines. Every line, ring and letter stroke is sturdy — the thinnest stroke at least about 4% of the logo's height. Lettering is regular to bold weight, never thin or light.",
  "TYPOGRAPHY: deliberate, optically spaced lettering with a clear hierarchy. In a name of several words the distinctive word leads; generic descriptor words (e.g. Family, Orthodontics, Studio, Co.) are clearly smaller, often uppercase with generous letter-spacing on their own line. Text and symbol form one balanced lockup.",
  "COLOUR DISCIPLINE: all lettering in ONE colour — never give different words or letters different colours. The symbol may use the main colour; an accent colour at most on one small element. 1–3 colours in total.",
].join("\n");

/**
 * The colour instruction. A palette with hex values (the user's, or one built by palette.ts) is
 * locked: those exact colours and no others, each with its job; plain colour words stay guidance.
 */
export function paletteLine(colors: string[]) {
  if (!colors.length) return "Colours: choose a fitting, restrained palette (1–2 colours).";
  if (!briefHexes(colors).length) return `Colours: ${colors.join(", ")}.`;
  const role = (c: string) => (/^primary\b/i.test(c) ? " — main colour for the symbol" : /^accent\b/i.test(c) ? " — sparingly, for one detail or highlight" : /^neutral\b/i.test(c) ? " — for the lettering" : "");
  return `PALETTE (use only these flat colours — 1 to 3 of them, not necessarily all; white is the background): ${colors.map((c) => `${c}${role(c)}`).join("; ")}. All lettering in one of them; never a different colour per word.`;
}

/**
 * The prompt for one concept. With a plan (concept-plan.ts) the concept follows its planned idea;
 * without one, `index` picks a creative lean (0–3). The client's existing idea (brief.direction)
 * reaches the drawing only through the plan that refines it, never every concept.
 */
export function buildConceptPrompt(brief: LogoBrief, references: ReferenceNote[], index = 0, plan?: ConceptPlan | null) {
  const type = logoType(brief.logoType);
  const facts = [
    brief.industry && `Industry: ${brief.industry}.`,
    brief.audience && `Audience: ${brief.audience}.`,
    brief.personality.length && `Personality: ${brief.personality.join(", ")}.`,
    !plan && brief.symbolIdeas.length && type.id !== "wordmark" && type.id !== "lettermark" && type.id !== "letterform" && `Symbol ideas to explore (pick or merge, keep it simple): ${brief.symbolIdeas.join("; ")}.`,
    paletteLine(brief.colors),
    brief.typography && `Lettering direction: ${brief.typography}.`,
    brief.mustHave.length && `Must have: ${brief.mustHave.join("; ")}.`,
    brief.avoid.length && `Avoid: ${brief.avoid.join("; ")}.`,
  ].filter(Boolean);
  const refs = references.length
    ? [
        "REFERENCES: These notes describe reference images. Apply each ONLY for its stated role and create something new — never reproduce a reference's symbol, wording or overall design.",
        ...references.map((r) => `- ${r.role.toUpperCase()} ONLY: ${r.description}`),
      ].join("\n")
    : "";
  return [
    `Design an original, professional logo${brief.brandName ? ` for ${JSON.stringify(brief.brandName)}` : ""}. ${brief.summary}`.trim(),
    brief.story && `ABOUT THE BRAND: ${brief.story}`,
    `LOGO TYPE — ${type.label.toUpperCase()}: ${type.rule}`,
    facts.join("\n"),
    refs,
    ...textRules(brief),
    plan ? planLines(plan, index) : `CREATIVE DIRECTION (concept ${index + 1}): ${DIRECTIONS[index % DIRECTIONS.length]} Stay true to the brief's personality.`,
    DESIGN_RULES,
    OUTPUT_RULES,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** A local correction of a concept that failed review: fix the listed issues, change nothing else. */
export function buildFixPrompt(brief: LogoBrief, issues: string[]) {
  return [
    "Image 1 is a logo draft. Edit it to fix ONLY the issues listed below. Keep the same concept, symbol, layout, colours and lettering style; do not redesign it.",
    `ISSUES TO FIX:\n${issues.map((i, k) => `${k + 1}. ${i}`).join("\n")}`,
    ...textRules(brief),
    OUTPUT_RULES,
  ].join("\n\n");
}

export type CheckId =
  | "background" | "margin" | "clean" | "colors" | "mono" | "small" | "weight" | "original"
  | "spelling" | "extra_text" | "type" | "brief" | "references" | "flat" | "quality";

/**
 * A box a concept is checked against. Blocking boxes decide whether a concept is shown; the
 * others are notes: shown on the concept, sent along with fixes, but never enough to hide it.
 * Only what the user can't live with blocks — a misspelt name, artwork cut off, a mockup, broken
 * shapes, a copied reference — so real AI output isn't held back by taste or tiny-size detail.
 */
export type CheckDef = { id: CheckId; label: string; by: "code" | "ai"; blocking: boolean };

/** Every box a concept is checked against before it is shown. */
export function checklist(brief: LogoBrief, hasReferences: boolean): CheckDef[] {
  const text = requiredText(brief);
  const hasLetters = Boolean(text.name || ((brief.logoType === "lettermark" || brief.logoType === "letterform") && brief.brandName));
  const defs: (CheckDef | false)[] = [
    { id: "background", label: "Clean background", by: "code", blocking: true },
    { id: "margin", label: "Nothing cut off", by: "code", blocking: true },
    { id: "clean", label: "Traces to a clean vector", by: "code", blocking: false },
    { id: "colors", label: "Colour count fits the brief", by: "code", blocking: false },
    { id: "mono", label: "Works in one colour", by: "code", blocking: false },
    { id: "weight", label: "Sturdy strokes, no hairlines", by: "code", blocking: true },
    { id: "small", label: "Readable when small", by: "code", blocking: false },
    hasReferences && { id: "original", label: "Doesn't copy a reference", by: "code", blocking: true },
    hasLetters && { id: "spelling", label: "Text spelled exactly", by: "ai", blocking: true },
    { id: "extra_text", label: "No extra text", by: "ai", blocking: true },
    { id: "type", label: "Right logo type", by: "ai", blocking: true },
    { id: "brief", label: "Matches the brief", by: "ai", blocking: false },
    hasReferences && { id: "references", label: "References used only for their role", by: "ai", blocking: false },
    { id: "flat", label: "Flat logo, no mockup", by: "ai", blocking: true },
    { id: "quality", label: "No broken shapes or artefacts", by: "ai", blocking: true },
  ];
  return defs.filter((d): d is CheckDef => Boolean(d));
}

export type CheckResult = { id: CheckId; pass: boolean; issue: string };

const AI_CHECK_TEXT: Record<Exclude<CheckId, "background" | "margin" | "clean" | "colors" | "mono" | "small" | "weight" | "original">, string> = {
  spelling: "Read every letter in the image left to right. It must match the EXPECTED TEXT exactly (letters, case, count, order). Any missing, extra, swapped, malformed or ambiguous letter fails.",
  extra_text: "There is no text, letter, number, watermark or label beyond the EXPECTED TEXT.",
  type: "The design is clearly the requested LOGO TYPE.",
  brief: "It fits the brief's personality, colours, must-haves and avoids.",
  references: "Each reference role is respected and nothing is copied outright from a reference.",
  flat: "It is a single flat logo on a plain white background: not a photo, 3D render, mockup, scene, sketch sheet or multiple versions.",
  quality: "No broken, melted, doubled or malformed shapes; no stray marks or artefacts; consistent professional finish.",
};

/** Instructions for the reviewer model, listing only the checks it is responsible for. */
export function buildReviewPrompt(brief: LogoBrief, references: ReferenceNote[], checks: CheckDef[]) {
  const text = requiredText(brief);
  const letters = brief.logoType === "lettermark" || brief.logoType === "letterform" ? initials(brief) : "";
  const expected = [text.name, text.tagline, letters].filter(Boolean);
  const ai = checks.filter((c) => c.by === "ai");
  return [
    "You are a strict senior brand designer doing quality control on a generated logo before a client sees it. Be exacting: if in doubt, fail the check and say precisely what to change.",
    `LOGO TYPE: ${logoType(brief.logoType).label} — ${logoType(brief.logoType).rule}`,
    `EXPECTED TEXT: ${expected.length ? expected.map((t) => JSON.stringify(t)).join(" and ") : "none — the logo must contain no text"}`,
    `BRIEF: ${brief.summary} Personality: ${brief.personality.join(", ") || "n/a"}. Colours: ${brief.colors.join(", ") || "any restrained palette"}. Must have: ${brief.mustHave.join("; ") || "n/a"}. Avoid: ${brief.avoid.join("; ") || "n/a"}.`,
    references.length ? `REFERENCE ROLES: ${references.map((r) => `${r.role}: ${r.description}`).join(" | ")}` : "",
    `CHECKS (return one result per id):\n${ai.map((c) => `- ${c.id}: ${AI_CHECK_TEXT[c.id as keyof typeof AI_CHECK_TEXT]}`).join("\n")}`,
    "For each failed check, `issue` is a short, concrete instruction an image editor can apply (e.g. \"The second letter reads 'c' — redraw it as 'o'\"). For passed checks, `issue` is empty. `textSeen` is all text you can read in the image, exactly as drawn.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    textSeen: { type: "string" },
    checks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { id: { type: "string" }, pass: { type: "boolean" }, issue: { type: "string" } },
        required: ["id", "pass", "issue"],
      },
    },
  },
  required: ["textSeen", "checks"],
} as const;

/** Reads the reviewer's answer: every expected AI check gets a result, a missing one counts as failed. */
export function parseReview(raw: unknown, checks: CheckDef[]): { results: CheckResult[]; textSeen: string } {
  const r = (raw && typeof raw === "object" ? raw : {}) as { checks?: unknown; textSeen?: unknown };
  const got = Array.isArray(r.checks) ? (r.checks as { id?: unknown; pass?: unknown; issue?: unknown }[]) : [];
  const results = checks
    .filter((c) => c.by === "ai")
    .map((c): CheckResult => {
      const m = got.find((g) => g.id === c.id);
      if (!m) return { id: c.id, pass: false, issue: `Could not confirm: ${c.label.toLowerCase()}.` };
      const pass = m.pass === true;
      return { id: c.id, pass, issue: pass ? "" : typeof m.issue === "string" && m.issue.trim() ? m.issue.trim().slice(0, 300) : `Fix: ${c.label.toLowerCase()}.` };
    });
  return { results, textSeen: typeof r.textSeen === "string" ? r.textSeen.slice(0, 200) : "" };
}

/** All text the artwork must contain (name, tagline or initials). */
export function expectedText(brief: LogoBrief) {
  const t = requiredText(brief);
  const letters = brief.logoType === "lettermark" || brief.logoType === "letterform" ? initials(brief) : "";
  return [t.name, t.tagline, letters].filter(Boolean);
}

/**
 * Second opinion on spelling: the reviewer must also have *read* each expected text in the image
 * (spacing and line breaks ignored, case kept). A pass without a matching reading becomes a fail.
 */
export function crossCheckSpelling(results: CheckResult[], textSeen: string, expected: string[]): CheckResult[] {
  const squash = (s: string) => s.replace(/\s+/g, "");
  const seen = squash(textSeen);
  const missing = expected.filter((e) => !seen.includes(squash(e)));
  return results.map((r) =>
    r.id === "spelling" && r.pass && missing.length
      ? { id: r.id, pass: false, issue: `The text must read ${missing.map((m) => JSON.stringify(m)).join(" and ")} exactly; it currently reads ${JSON.stringify(textSeen || "nothing legible")}. Redraw the letters so they spell it exactly.` }
      : r,
  );
}

// The logo brief (pure, shared by client and server): logo types, reference roles, the cleanup
// instructions and JSON schema for the brief model, and validation of what it returns.

export const LOGO_TYPES = [
  {
    id: "combination",
    label: "Combination mark",
    short: "Symbol + name",
    rule: "A distinctive symbol paired with the brand name in custom lettering, designed as one balanced lockup (symbol beside or above the name). The symbol and the lettering must share one design language (stroke weight, corner style, geometry), and each must also work on its own.",
  },
  {
    id: "wordmark",
    label: "Wordmark",
    short: "The name, custom-lettered",
    rule: "The full brand name as the whole logo, in unique custom lettering: no separate symbol. Give the letterforms a memorable, ownable detail (a custom terminal, ligature, cut, counter or letter modification) that fits the brand, while every letter stays clearly readable.",
  },
  {
    id: "lettermark",
    label: "Lettermark / monogram",
    short: "Initials",
    rule: "The brand's initials (typically 1–3 letters) designed into one compact, distinctive monogram: letters may interlock, share strokes or sit in a simple shape, but each letter must stay identifiable. Show only the initials unless the brief says to include the name.",
  },
  {
    id: "letterform",
    label: "Letterform",
    short: "One stylised letter",
    rule: "A single stylised letter (the brand's first letter unless the brief says otherwise) built into a bold, simple, iconic mark that works as an app icon. Only that letter.",
  },
  {
    id: "pictorial",
    label: "Pictorial mark",
    short: "Symbol only",
    rule: "A single recognisable, simplified symbol of a real object or creature that represents the brand, with no text. Bold silhouette, minimal detail, readable at favicon size.",
  },
  {
    id: "abstract",
    label: "Abstract mark",
    short: "Geometric symbol",
    rule: "A distinctive abstract symbol built from geometric shapes, lines or patterns (not a literal object) that conveys the brand's idea and personality, with no text. Simple enough to redraw from memory.",
  },
  {
    id: "emblem",
    label: "Emblem",
    short: "Badge or crest",
    rule: "The brand name (and optional symbol) contained inside a badge, seal, shield or crest shape, designed as one unit. Keep it bold and simple enough to stay readable when small: few elements, thick strokes, large lettering.",
  },
  {
    id: "mascot",
    label: "Mascot",
    short: "Character",
    rule: "A friendly, distinctive character that represents the brand, drawn as a clean flat vector illustration with bold outlines and few colours, optionally paired with the brand name in custom lettering.",
  },
  {
    id: "line",
    label: "Line drawing",
    short: "Single-weight strokes",
    rule: "A minimal mark drawn with clean, even-weight strokes (one continuous line or a few separate lines), optionally paired with the brand name in matching custom lettering. Consistent stroke weight throughout; no fills except the lettering.",
  },
] as const;

export type LogoTypeId = (typeof LOGO_TYPES)[number]["id"];
export const LOGO_TYPE_IDS = LOGO_TYPES.map((t) => t.id) as LogoTypeId[];
/** The most common type among professional brand logos, and the most flexible (symbol and name also work apart). */
export const DEFAULT_LOGO_TYPE: LogoTypeId = "combination";
export const logoType = (id: LogoTypeId) => LOGO_TYPES.find((t) => t.id === id) ?? LOGO_TYPES[0];
/** Types whose artwork contains the full brand name. */
export const SHOWS_NAME: readonly LogoTypeId[] = ["combination", "wordmark", "emblem"];

export const REFERENCE_ROLES = [
  { id: "typography", label: "Typography", hint: "Letter shapes only" },
  { id: "style", label: "Style", hint: "Look and rendering" },
  { id: "colour", label: "Colour", hint: "Its palette" },
  { id: "layout", label: "Layout", hint: "Arrangement only" },
  { id: "concept", label: "Concept", hint: "The idea, not the drawing" },
  { id: "mood", label: "Mood", hint: "Loose feeling" },
] as const;
export type ReferenceRole = (typeof REFERENCE_ROLES)[number]["id"];
export const REFERENCE_ROLE_IDS = REFERENCE_ROLES.map((r) => r.id) as ReferenceRole[];
export const MAX_REFERENCES = 4;

/** What a reference contributes, written as words so the image model can't copy the picture. */
export type ReferenceNote = { role: ReferenceRole; description: string };

/**
 * What the vision model extracts from a reference for each role. Everything outside the role is
 * deliberately left out, so e.g. a typography reference never leaks its symbol or colours.
 */
export function referenceInstructions(role: ReferenceRole) {
  const only: Record<ReferenceRole, string> = {
    typography:
      "Describe ONLY its lettering: classification (serif, sans, slab, script, display), weight, width, case, contrast between thick and thin strokes, terminals, corner treatment (sharp, rounded, cut), x-height and proportions, letter spacing, and any distinctive letterform details. Do NOT mention its words, symbols, colours, layout or subject.",
    style:
      "Describe ONLY its visual style: geometric vs organic, line weight, level of detail, flat vs dimensional, corner treatment, use of negative space, symmetry, and overall rendering approach. Do NOT mention its subject, symbols, words or exact colours.",
    colour:
      "Describe ONLY its colour palette: list each main colour as a hex value with its role (dominant, accent, background), and the overall contrast and temperature. Do NOT mention shapes, words or subject.",
    layout:
      "Describe ONLY its composition: how elements are arranged (symbol left of text, stacked, centred, enclosed in a badge), relative sizes and alignment. Do NOT describe what the elements depict, their style, words or colours.",
    concept:
      "Describe ONLY the idea it communicates and the metaphor used to express it, in abstract terms another designer could reinterpret in a completely new drawing. Do NOT describe its exact shapes, words, colours or layout.",
    mood: "Describe ONLY the feeling it gives in 3–6 adjectives (e.g. calm, premium, playful). Nothing else.",
  };
  return `You are a senior brand designer extracting one quality from a reference image for a new, original logo. ${only[role]} Write at most 70 words of plain text, no lists or preamble. The new logo must not copy the reference, so describe principles, not a recipe for recreating it.`;
}

export type LogoBrief = {
  /** Exactly as the user wrote it (never corrected); "" when they gave none. */
  brandName: string;
  tagline: string;
  industry: string;
  audience: string;
  personality: string[];
  logoType: LogoTypeId;
  typeReason: string;
  alternativeTypes: LogoTypeId[];
  symbolIdeas: string[];
  colors: string[];
  typography: string;
  mustHave: string[];
  avoid: string[];
  /** One clear sentence an image model can act on. */
  summary: string;
  /** Critical facts the user did not give (e.g. "brand name"). */
  missing: string[];
};

export const BRIEF_INSTRUCTIONS = [
  "You turn a client's messy, unordered notes into a precise logo design brief for an image model. Read everything, including fragments, typos and asides, and work out exactly what logo they need.",
  "PASTED PAGES: the notes may be copied from a web page, job post, design-contest listing, email or document. Ignore everything that isn't about the brand or the logo: navigation and menus, headers and footers, cookie and legal notices, links, buttons, social links, ads, prices, contest rules, platform boilerplate, author bios and unrelated page content. Extract only the actual brief. Never carry over deliverables, final file formats, template downloads, \"convert text to outlines\" instructions or platform policy notes (such as rules about generative AI use).",
  "BRAND NAME AND TAGLINE: copy them character for character exactly as the client typed them — same spelling, case, spaces and punctuation. Never correct, translate, expand or invent them. If the client gave no name, leave brandName empty and add \"brand name\" to missing. Only include a tagline the client explicitly asked to appear in the logo.",
  "EMPTY FIELDS: form placeholders such as \"Unspecified\", \"Not specified\", \"None\", \"N/A\" or \"—\" mean the client gave nothing for that field. Leave it empty — never use the placeholder word itself as a slogan, name, colour or anything else.",
  `LOGO TYPE: choose one of: ${LOGO_TYPES.map((t) => `${t.id} (${t.short})`).join(", ")}. Combination marks are by far the most common choice for professional brands and the safest default: use "combination" unless the notes clearly point elsewhere. Signals: the client asks for a type by name or description → use it; only initials / a long or multi-word name they want shortened → lettermark; wants just the name, or the name is short and distinctive with no symbol idea → wordmark; wants an app-icon-like single letter → letterform; wants only an icon of a concrete thing → pictorial; tech, finance or an abstract idea with no concrete object, symbol only → abstract; heritage, craft beer, coffee, schools, clubs, sports, "badge", "vintage" → emblem; kids, food, gaming, sports teams, "character" → mascot; "minimal line", "single line", "outline" → line. Give a one-sentence reason and two sensible alternatives.`,
  "Fill the other fields from the notes, inferring sensibly where the client implies something (e.g. a children's dentist suggests friendly and playful). personality: 3–5 adjectives. colors: plain colour names or hex values the client wants (empty if none stated; you may infer one fitting direction). typography: the lettering direction (e.g. \"rounded geometric sans, lowercase\"). symbolIdeas: 0–3 concrete symbol ideas if a symbol is part of the type. mustHave / avoid: explicit requirements and exclusions. summary: one clear sentence describing the logo to design.",
  "Use the reference notes, if any, as facts about what each reference image should contribute; do not change their roles.",
].join("\n");

const str = { type: "string" } as const;
const strList = { type: "array", items: str } as const;
const typeEnum = { type: "string", enum: LOGO_TYPE_IDS } as const;

/** Strict JSON schema for OpenAI structured outputs. */
export const BRIEF_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    brandName: str,
    tagline: str,
    industry: str,
    audience: str,
    personality: strList,
    logoType: typeEnum,
    typeReason: str,
    alternativeTypes: { type: "array", items: typeEnum },
    symbolIdeas: strList,
    colors: strList,
    typography: str,
    mustHave: strList,
    avoid: strList,
    summary: str,
    missing: strList,
  },
  required: ["brandName", "tagline", "industry", "audience", "personality", "logoType", "typeReason", "alternativeTypes", "symbolIdeas", "colors", "typography", "mustHave", "avoid", "summary", "missing"],
} as const;

/**
 * Form placeholders meaning "nothing was given" ("Unspecified", "None", "N/A", "—"…). A field
 * holding only one of these is empty: never a slogan, name or colour to draw.
 */
export const PLACEHOLDER = /^[\s"'“”‘’([]*(unspecified|not specified|none( specified| given| provided)?|no(ne)?|n\/?a|nil|null|undefined|tbd|tbc|to be (decided|determined|confirmed)|no (slogan|tagline|text|preference|name)|-+|–|—|\.+|\?+|empty|blank|not applicable)[\s"'“”‘’)\].!]*$/i;

export function isPlaceholder(v: string) {
  return PLACEHOLDER.test(v.trim());
}

const text = (v: unknown, max = 300) => {
  const t = typeof v === "string" ? v.trim().slice(0, max) : "";
  return isPlaceholder(t) ? "" : t;
};
const list = (v: unknown, n = 6, max = 120) => (Array.isArray(v) ? v.map((x) => text(x, max)).filter(Boolean).slice(0, n) : []);
const isType = (v: unknown): v is LogoTypeId => typeof v === "string" && (LOGO_TYPE_IDS as string[]).includes(v);

/** Validates a brief from the model (or the editor), filling safe defaults for anything missing. */
export function normalizeBrief(raw: unknown): LogoBrief {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const logoType = isType(r["logoType"]) ? r["logoType"] : DEFAULT_LOGO_TYPE;
  return {
    // A brand may really be called "Nil" or "NA": only unmistakable placeholders are blanked.
    brandName: ((n) => (/^[\s"'(]*(unspecified|not specified|n\/a)[\s"').]*$/i.test(n) ? "" : n))(typeof r["brandName"] === "string" ? r["brandName"].trim().slice(0, 60) : ""),
    tagline: text(r["tagline"], 80),
    industry: text(r["industry"], 120),
    audience: text(r["audience"], 160),
    personality: list(r["personality"], 5, 30),
    logoType,
    typeReason: text(r["typeReason"], 200),
    alternativeTypes: (Array.isArray(r["alternativeTypes"]) ? r["alternativeTypes"] : []).filter(isType).filter((t, i, a) => t !== logoType && a.indexOf(t) === i).slice(0, 2),
    symbolIdeas: list(r["symbolIdeas"], 3),
    colors: list(r["colors"], 5, 40),
    typography: text(r["typography"], 160),
    mustHave: list(r["mustHave"], 6),
    avoid: list(r["avoid"], 6),
    summary: text(r["summary"], 400),
    missing: list(r["missing"], 4, 60),
  };
}

/** The user's raw notes plus reference notes, as the brief model's input. */
export function briefInput(notes: string, references: ReferenceNote[]) {
  return [
    `CLIENT NOTES:\n${notes.trim().slice(0, 8000)}`,
    references.length
      ? `REFERENCE IMAGES (already analysed):\n${references.map((r, i) => `${i + 1}. Use for ${r.role.toUpperCase()} only: ${r.description}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Splits a block of text into separate briefs for batch: blank lines, "---" lines or numbered
 * items ("1." / "2)") start a new brief.
 */
export function splitBriefs(block: string) {
  const parts = block
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*(?:-{3,}|={3,})\s*\n|\n\s*\n|\n(?=\s*\d{1,2}[.)]\s)/)
    .map((p) => p.replace(/^\s*\d{1,2}[.)]\s+/, "").trim())
    .filter((p) => p.length >= 3);
  return parts.slice(0, 24);
}

// Concept planning (pure, shared by client and server). Before a round is drawn, an art-director
// step plans one genuinely different idea per concept — its meaning, symbol, lettering, colour use
// and lockup — so a round explores ideas instead of three style variations of the same thing, and
// a client's existing idea is refined in one concept only (live run: every concept was the
// client's "thin gold ring with a T", in thin type, each word a different colour).
import { initials, requiredText } from "@/lib/concept-prompt";
import { logoType, type LogoBrief, type ReferenceNote } from "@/lib/brief";

export type ConceptPlan = {
  /** Two or three words naming the idea, shown on the concept card ("Aligned arc"). */
  name: string;
  /** The idea and what it means for this brand, in one or two sentences. */
  idea: string;
  /** What the symbol is and how it is built (or "none" for a pure wordmark). */
  symbol: string;
  /** The lettering: weight, case, width, style, spacing, hierarchy and its one custom detail. */
  lettering: string;
  /** Which palette colour goes where. */
  color: string;
  /** How symbol and text are arranged. */
  layout: string;
};

const FIELDS = ["name", "idea", "symbol", "lettering", "color", "layout"] as const;
const LIMIT: Record<(typeof FIELDS)[number], number> = { name: 40, idea: 400, symbol: 400, lettering: 400, color: 300, layout: 300 };

export const PLAN_INSTRUCTIONS = [
  "You are the art director of a top brand-identity studio planning one round of logo concepts for an image model to draw. Plan exactly the number of concepts asked for.",
  "DIFFERENT IDEAS: every concept must be a genuinely different idea — a different symbol or concept AND a different lettering approach — never the same idea in another style. Ground each idea in the brand's story (what the business does, what makes it different, how it should feel), not in generic industry imagery.",
  "CLIENT'S EXISTING IDEA: if the brief has a direction the client already has in mind, exactly ONE concept refines it into something more ownable and better crafted (bolder construction, a custom detail, real weight) — never a literal copy. All other concepts explore new ideas. If there is no such direction, all concepts are new.",
  "STRATEGIES to spread across the round (pick different ones): a meaningful symbol + wordmark; a custom monogram or lettermark built from the initials; a wordmark-led design with one distinctive custom detail; an emblem or seal; an abstract mark expressing the story. Stay within the requested logo type and its alternatives.",
  "CRAFT (state it concretely in each plan): the symbol is 1–3 simple, sturdy shapes that still read at 24 px and embroidered on a hat — no hairlines, no thin outline rings, no fine detail. Lettering is regular-to-bold weight (never thin or light), with a specific case, width and style chosen for a reason, optically spaced, and one custom detail. For a name of several words, set a clear hierarchy: the distinctive word (usually the surname or coined word) is the hero; generic descriptor words (Family, Orthodontics, Studio, Co., Group, Dental…) are much smaller, usually uppercase with wide letter-spacing on their own line.",
  "COLOUR: say exactly which palette colour goes where. All lettering in ONE colour; the symbol in the main colour; at most one small accent. Never give different words or letters different colours. Use 1–3 colours, not necessarily all of the palette.",
  "AVOID: everything in the brief's avoid list and the clichés of the category (e.g. teeth for dentists, generic swooshes, a plain letter inside a thin circle unless it is the client's idea being refined), stock icons, and any idea listed as already tried.",
  "Write each field as short, concrete drawing instructions an image model can follow. name: 2–3 words. Do not invent a tagline or extra text.",
].join("\n");

export const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    concepts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: Object.fromEntries(FIELDS.map((f) => [f, { type: "string" }])),
        required: [...FIELDS],
      },
    },
  },
  required: ["concepts"],
} as const;

/** The planner's input: the brief, reference notes, how many concepts, and ideas already tried. */
export function planInput(brief: LogoBrief, references: ReferenceNote[], count: number, tried: string[] = []) {
  const type = logoType(brief.logoType);
  const text = requiredText(brief);
  return [
    `CONCEPTS TO PLAN: ${count}`,
    `BRAND NAME: ${brief.brandName ? JSON.stringify(brief.brandName) : "none given"}${text.tagline ? ` · TAGLINE: ${JSON.stringify(text.tagline)}` : ""}`,
    `LOGO TYPE: ${type.label} — ${type.rule}${brief.alternativeTypes.length ? ` (alternatives allowed: ${brief.alternativeTypes.map((t) => logoType(t).label).join(", ")})` : ""}`,
    brief.story && `STORY: ${brief.story}`,
    brief.summary && `SUMMARY: ${brief.summary}`,
    brief.industry && `INDUSTRY: ${brief.industry}`,
    brief.audience && `AUDIENCE: ${brief.audience}`,
    brief.personality.length && `PERSONALITY: ${brief.personality.join(", ")}`,
    brief.colors.length && `PALETTE: ${brief.colors.join("; ")}`,
    brief.typography && `LETTERING NOTES: ${brief.typography}`,
    brief.symbolIdeas.length && `SYMBOL IDEAS FROM THE BRIEF: ${brief.symbolIdeas.join("; ")}`,
    brief.direction && `CLIENT'S EXISTING IDEA (refine in exactly one concept): ${brief.direction}`,
    brief.mustHave.length && `MUST HAVE: ${brief.mustHave.join("; ")}`,
    brief.avoid.length && `AVOID: ${brief.avoid.join("; ")}`,
    references.length && `REFERENCE NOTES (each only for its role): ${references.map((r) => `${r.role}: ${r.description}`).join(" | ")}`,
    tried.length && `ALREADY TRIED IN EARLIER ROUNDS (do something else): ${tried.join(" | ")}`,
  ]
    .filter(Boolean)
    .join("\n");
}

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** One plan from untrusted input (the planner's answer or a request body), bounded; null if empty. */
export function normalizePlan(raw: unknown): ConceptPlan | null {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const plan = Object.fromEntries(FIELDS.map((f) => [f, clean(r[f], LIMIT[f])])) as ConceptPlan;
  return plan.idea || plan.symbol || plan.lettering ? { ...plan, name: plan.name || "Concept" } : null;
}

/**
 * Plans when the planner is unavailable: distinct strategies built from the brief alone (the
 * client's idea refined first when there is one, then symbol, monogram and wordmark-led).
 */
export function fallbackPlans(brief: LogoBrief, count: number): ConceptPlan[] {
  const name = brief.brandName || "the brand";
  const letters = initials({ ...brief, logoType: "lettermark" }) || "the initials";
  const symbolIdea = brief.symbolIdeas[0] || "a simple symbol expressing what makes the brand different";
  const lettering = "Custom lettering in a regular-to-medium weight (never thin), optically spaced, with one distinctive detail; descriptor words smaller, uppercase and widely spaced on a second line.";
  const color = "All lettering in the darkest palette colour; the symbol in the main colour; at most one small accent.";
  const all: ConceptPlan[] = [
    ...(brief.direction
      ? [{ name: "Client idea, refined", idea: `The client's own idea, made ownable: ${brief.direction}`, symbol: "The client's idea rebuilt with sturdy, even strokes and one custom detail — no hairlines.", lettering, color, layout: "Symbol above or beside the name, balanced as one lockup." }]
      : []),
    { name: "Story symbol", idea: `A symbol for ${name} built on its story.`, symbol: `${symbolIdea}, reduced to 1–3 bold, simple shapes.`, lettering, color, layout: "Symbol to the left of the name, vertically centred." },
    { name: "Monogram", idea: `A custom monogram from ${letters}, constructed as one ownable mark.`, symbol: `The letters ${letters} interlocked or sharing strokes, in sturdy even weight.`, lettering, color, layout: "Monogram above the name, centred." },
    { name: "Signature wordmark", idea: `The name ${name} carries the identity, with one memorable custom detail.`, symbol: "none — the custom detail lives in the lettering", lettering: "Distinctive custom wordmark, medium-to-bold weight, one signature detail (a ligature, cut or terminal) tied to the story; descriptor words small, uppercase, widely spaced below.", color, layout: "Hero word on top, descriptor line centred beneath." },
  ];
  return Array.from({ length: count }, (_, i) => all[i % all.length]!);
}

/** The planner's answer → exactly `count` plans (gaps filled from the fallback). */
export function readPlans(raw: unknown, brief: LogoBrief, count: number): ConceptPlan[] {
  const list = raw && typeof raw === "object" && Array.isArray((raw as { concepts?: unknown }).concepts) ? ((raw as { concepts: unknown[] }).concepts) : [];
  const plans = list.map(normalizePlan).filter((p): p is ConceptPlan => Boolean(p)).slice(0, count);
  const extra = fallbackPlans(brief, count).filter((f) => !plans.some((p) => p.name === f.name));
  while (plans.length < count) plans.push(extra.shift() ?? fallbackPlans(brief, count)[plans.length]!);
  return plans;
}

/** The plan as prompt text for one concept. */
export function planLines(plan: ConceptPlan, index: number) {
  return [
    `CONCEPT ${index + 1} — ${plan.name.toUpperCase()}: ${plan.idea}`,
    plan.symbol && `Symbol: ${plan.symbol}`,
    plan.lettering && `Lettering: ${plan.lettering}`,
    plan.color && `Colour use: ${plan.color}`,
    plan.layout && `Layout: ${plan.layout}`,
    "Follow this concept closely; it was planned to differ from the other concepts in the round.",
  ]
    .filter(Boolean)
    .join("\n");
}

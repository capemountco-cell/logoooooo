// Automatic reference images for a brief (pure, shared): search queries, provider result parsing,
// the image-host allowlist, and the instructions for the model that picks the best references.
// Picked references reach the image model as role-limited text and, when allowed, as pictures (see brief.ts).
import { logoType, type LogoBrief, type ReferenceRole } from "@/lib/brief";
import { requiredText } from "@/lib/concept-prompt";

export type SearchProvider = "brave" | "openverse";

/** One image search result (thumbnail shown in the review panel; never stored). */
export type Candidate = {
  id: string;
  /** Thumbnail URL on an allowlisted host (Brave's image proxy or Openverse). */
  thumb: string;
  /** The page the image comes from. */
  source: string;
  title: string;
  /** Which search produced it. */
  query: string;
  provider: SearchProvider | "library";
};

/** A reference in use: the role it serves, its role-limited description and its picture. */
export type AutoReference = {
  role: ReferenceRole;
  description: string;
  /** Data URL of the thumbnail (for the review panel and the copy check). */
  image: string;
  /** The search result it came from (none for the designer's own saved references). */
  candidate?: Candidate;
};

/** A reference the designer saved to "My references" (stored on the device, sent as a small image). */
export type LibraryItem = { id: string; image: string; role: ReferenceRole; note: string };

const TYPE_QUERY: Record<string, string> = {
  combination: "logo design",
  wordmark: "wordmark logo",
  lettermark: "monogram logo",
  letterform: "letter logo mark",
  pictorial: "icon logo",
  abstract: "abstract logo mark",
  emblem: "badge emblem logo",
  mascot: "mascot logo",
  line: "line art logo",
};

const clean = (s: string) => s.replace(/[^\p{L}\p{N}\s&'-]/gu, " ").replace(/\s+/g, " ").trim();
const firstWords = (s: string, n: number) => clean(s).split(" ").slice(0, n).join(" ");

export type ReferenceQuery = { query: string; roles: ReferenceRole[] };

// ---------- searching like a designer ----------

/**
 * Instructions for the AI that writes the searches. A designer doesn't search the brief's literal
 * subject ("chicken restaurant logo" returns other chicken logos, mostly amateur contest entries):
 * they search the visual language they want, look at best-in-class work from neighbouring
 * categories, and use curated galleries.
 */
export const SEARCH_PLAN_INSTRUCTIONS = [
  "You are a senior brand designer gathering reference logos for a new identity. Write 3 or 4 image searches (Brave Image Search) that will surface excellent, professional reference work.",
  "SEARCH LIKE A DESIGNER: describe the visual language wanted — lettering style, shape language, era, construction, rendering (e.g. \"chunky hand-lettered brush wordmark\", \"bold retro badge emblem logo\", \"geometric monogram logo grid construction\") — not the literal subject. Avoid the category's clichés and literal objects unless the concept truly needs them. One search may look at best-in-class brands from a neighbouring category with the same feel.",
  "QUALITY SOURCES: add \"dribbble\" or \"behance\" to most searches so results come from curated design galleries rather than contest entries or clip art.",
  "ROLES: each search serves one or more of: style (overall look), typography (lettering, only when the logo has text), concept (the kind of idea). Cover every role you are asked for. 3–7 words per search, no quotes, no brand names of the client.",
].join("\n");

export const SEARCH_PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    queries: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { query: { type: "string" }, roles: { type: "array", items: { type: "string", enum: ["style", "concept", "typography"] } } },
        required: ["query", "roles"],
      },
    },
  },
  required: ["queries"],
} as const;

export function searchPlanInput(brief: LogoBrief, roles: ReferenceRole[]) {
  return [
    `ROLES TO COVER: ${roles.join(", ")}`,
    `LOGO TYPE: ${logoType(brief.logoType).label}`,
    brief.industry && `INDUSTRY: ${brief.industry}`,
    brief.personality.length && `PERSONALITY: ${brief.personality.join(", ")}`,
    brief.typography && `LETTERING NOTES: ${brief.typography}`,
    brief.story && `STORY: ${brief.story}`,
    brief.summary && `SUMMARY: ${brief.summary}`,
    brief.avoid.length && `AVOID: ${brief.avoid.join("; ")}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** The planned searches → at most 4 clean queries limited to the asked roles; [] if unusable. */
export function readSearchPlan(raw: unknown, roles: ReferenceRole[]): ReferenceQuery[] {
  const list = (raw as { queries?: unknown })?.queries;
  if (!Array.isArray(list)) return [];
  const out: ReferenceQuery[] = [];
  for (const q of list as { query?: unknown; roles?: unknown }[]) {
    const query = clean(typeof q.query === "string" ? q.query : "").split(" ").slice(0, 9).join(" ");
    const r = (Array.isArray(q.roles) ? q.roles : []).filter((x): x is ReferenceRole => roles.includes(x as ReferenceRole));
    if (query.length >= 4 && r.length && !out.some((o) => o.query === query)) out.push({ query, roles: [...new Set(r)] });
    if (out.length >= 4) break;
  }
  // Every asked role must be covered by some search; otherwise the plan is not usable.
  return roles.every((role) => out.some((q) => q.roles.includes(role))) ? out : [];
}

/**
 * Up to two searches per brief (each costs one request): a visual one for style and concept,
 * and, when the logo has lettering, a typography one. Built from the brief, no AI needed.
 */
export function referenceQueries(brief: LogoBrief): ReferenceQuery[] {
  const subject = firstWords(brief.symbolIdeas[0] ?? "", 3) || firstWords(brief.industry, 3) || firstWords(brief.summary, 4);
  const mood = brief.personality.slice(0, 2).map((p) => firstWords(p, 2)).join(" ");
  const visual = clean([subject, mood, TYPE_QUERY[brief.logoType] ?? "logo design"].filter(Boolean).join(" "));
  const queries: ReferenceQuery[] = [{ query: visual || "minimal logo design", roles: ["style", "concept"] }];
  const lettered = Boolean(requiredText(brief).name) || brief.logoType === "lettermark" || brief.logoType === "letterform";
  if (lettered) {
    const type = firstWords(brief.typography, 4) || mood || "modern";
    queries.push({ query: clean(`${type} ${brief.logoType === "lettermark" ? "monogram" : "logotype"} lettering`), roles: ["typography"] });
  }
  return queries;
}

/** Hosts the server may fetch reference thumbnails from (never arbitrary URLs). */
export const IMAGE_HOSTS = ["imgs.search.brave.com", "api.openverse.org"] as const;

export function isAllowedImageUrl(url: string) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (IMAGE_HOSTS as readonly string[]).includes(u.hostname);
  } catch {
    return false;
  }
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Brave Image Search → candidates (thumbnails via Brave's proxy). */
export function parseBrave(json: unknown, query: string): Candidate[] {
  const results = (json as { results?: unknown[] })?.results;
  if (!Array.isArray(results)) return [];
  return results
    .map((r, i): Candidate => {
      const o = r as { title?: unknown; url?: unknown; thumbnail?: { src?: unknown } };
      return { id: `b:${query}:${i}`, thumb: str(o.thumbnail?.src), source: str(o.url), title: str(o.title).slice(0, 120), query, provider: "brave" };
    })
    .filter((c) => isAllowedImageUrl(c.thumb));
}

/** Openverse (openly licensed, no key) → candidates. */
export function parseOpenverse(json: unknown, query: string): Candidate[] {
  const results = (json as { results?: unknown[] })?.results;
  if (!Array.isArray(results)) return [];
  return results
    .map((r): Candidate => {
      const o = r as { id?: unknown; title?: unknown; thumbnail?: unknown; foreign_landing_url?: unknown };
      return { id: `o:${str(o.id)}`, thumb: str(o.thumbnail), source: str(o.foreign_landing_url), title: str(o.title).slice(0, 120), query, provider: "openverse" };
    })
    .filter((c) => c.id !== "o:" && isAllowedImageUrl(c.thumb));
}

/** The picker sees each search's top results (low detail, so it is cheap). */
export const PICK_PER_QUERY = 8;

export function pickInstructions(brief: LogoBrief, groups: { roles: ReferenceRole[]; count: number; library?: boolean }[]) {
  let offset = 0;
  const lines = groups.map((g) => {
    const range = `images ${offset}–${offset + g.count - 1}`;
    offset += g.count;
    return g.library ? `- ${range}: THE DESIGNER'S OWN SAVED REFERENCES (their taste) — prefer these for any role they fit` : `- ${range}: candidates for ${g.roles.join(" and ")}`;
  });
  return [
    "You are the art director of a top identity studio choosing references for a new, original logo — a small moodboard. Pick by index: up to 2 images for style, and 1 each for the other requested roles.",
    `BRIEF: ${brief.summary} Type: ${logoType(brief.logoType).label}. Personality: ${brief.personality.join(", ") || "n/a"}.`,
    `The images are numbered from 0 in the order given:\n${lines.join("\n")}`,
    "JUDGE LIKE A DESIGNER: pick work you would pin on a studio moodboard — distinctive, confidently drawn, well balanced and well spaced, with craft in the details (custom lettering, considered shapes), the kind featured on curated galleries. Prefer it over generic, amateur or contest-entry work, templates, clip art and literal category clichés. The image must clearly show the quality its role needs (lettering for typography; overall look for style; the kind of idea for concept).",
    "Reject photos, product mockups, website or app screenshots, stock watermarks, collages and sheets of many logos, and anything offensive.",
    "Each image may serve only one role. If no image is good enough for a role, leave that role out.",
  ].join("\n\n");
}

export const PICK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    picks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { role: { type: "string", enum: ["style", "concept", "typography"] }, index: { type: "integer" } },
        required: ["role", "index"],
      },
    },
  },
  required: ["picks"],
} as const;

/** Validates the picker's answer: known roles, in-range, distinct images; one per role. */
/** At most two style references (a small moodboard), one for every other role. */
export const PICK_LIMIT: Partial<Record<ReferenceRole, number>> = { style: 2 };

export function readPicks(raw: unknown, roles: ReferenceRole[], total: number): { role: ReferenceRole; index: number }[] {
  const picks = (raw as { picks?: unknown })?.picks;
  const used = new Set<number>();
  const out: { role: ReferenceRole; index: number }[] = [];
  if (!Array.isArray(picks)) return out;
  for (const p of picks as { role?: unknown; index?: unknown }[]) {
    const role = p.role as ReferenceRole;
    const index = typeof p.index === "number" ? Math.trunc(p.index) : -1;
    if (!roles.includes(role) || out.filter((o) => o.role === role).length >= (PICK_LIMIT[role] ?? 1) || index < 0 || index >= total || used.has(index)) continue;
    used.add(index);
    out.push({ role, index });
  }
  return out;
}

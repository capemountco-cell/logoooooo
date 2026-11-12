// Automatic reference images for a brief (pure, shared): search queries, provider result parsing,
// the image-host allowlist, and the instructions for the model that picks the best references.
// Picked references only ever reach the image models as role-limited text (see brief.ts).
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
  provider: SearchProvider;
};

/** A reference in use: the role it serves, its role-limited description and its picture. */
export type AutoReference = {
  role: ReferenceRole;
  description: string;
  /** Data URL of the thumbnail (for the review panel and the copy check). */
  image: string;
  candidate: Candidate;
};

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

export function pickInstructions(brief: LogoBrief, groups: { roles: ReferenceRole[]; count: number }[]) {
  let offset = 0;
  const lines = groups.map((g) => {
    const range = `images ${offset}–${offset + g.count - 1}`;
    offset += g.count;
    return `- ${range}: candidates for ${g.roles.join(" and ")}`;
  });
  return [
    "You are a senior brand designer choosing reference images for a new, original logo. Pick the most useful image for each requested role, by index.",
    `BRIEF: ${brief.summary} Type: ${logoType(brief.logoType).label}. Personality: ${brief.personality.join(", ") || "n/a"}.`,
    `The images are numbered from 0 in the order given:\n${lines.join("\n")}`,
    "Good references are clean, professional logo designs (or lettering for typography) whose quality matches the role. Reject photos, product mockups, website or app screenshots, stock watermarks, collages and sheets of many logos, low-quality clip art, and anything with offensive content.",
    "Pick a different image for each role. If no image is good enough for a role, use index -1 for it.",
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
export function readPicks(raw: unknown, roles: ReferenceRole[], total: number): { role: ReferenceRole; index: number }[] {
  const picks = (raw as { picks?: unknown })?.picks;
  const used = new Set<number>();
  const out: { role: ReferenceRole; index: number }[] = [];
  if (!Array.isArray(picks)) return out;
  for (const p of picks as { role?: unknown; index?: unknown }[]) {
    const role = p.role as ReferenceRole;
    const index = typeof p.index === "number" ? Math.trunc(p.index) : -1;
    if (!roles.includes(role) || out.some((o) => o.role === role) || index < 0 || index >= total || used.has(index)) continue;
    used.add(index);
    out.push({ role, index });
  }
  return out;
}

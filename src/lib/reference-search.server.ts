// Server side of automatic references: image search (Brave when BRAVE_API_KEY is set, otherwise
// or on failure Openverse, which needs no key), thumbnail fetching from allowlisted hosts only,
// the AI pick, and role-limited descriptions. Nothing is stored.
import { referenceInstructions, type LogoBrief, type ReferenceRole } from "@/lib/brief";
import { bytesToDataUrl, openaiJson, openaiText } from "@/lib/openai-text.server";
import {
  isAllowedImageUrl, parseBrave, parseOpenverse, pickInstructions, PICK_PER_QUERY, PICK_SCHEMA, readPicks, referenceQueries,
  type AutoReference, type Candidate, type SearchProvider,
} from "@/lib/reference-search";

const UA = "LOGOO/1.0 (logo reference search)";
const MAX_THUMB = 3_000_000;

async function braveSearch(query: string, key: string, signal?: AbortSignal) {
  const url = `https://api.search.brave.com/res/v1/images/search?${new URLSearchParams({ q: query, count: "20", safesearch: "strict", spellcheck: "false" })}`;
  const res = await fetch(url, { headers: { Accept: "application/json", "X-Subscription-Token": key, "User-Agent": UA }, signal: signal ?? null });
  if (!res.ok) throw new Error(`Brave image search failed (${res.status})`);
  return parseBrave(await res.json(), query);
}

async function openverseSearch(query: string, signal?: AbortSignal) {
  const url = `https://api.openverse.org/v1/images/?${new URLSearchParams({ q: query, page_size: "20", mature: "false" })}`;
  const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": UA }, signal: signal ?? null });
  if (!res.ok) throw new Error(`Openverse search failed (${res.status})`);
  return parseOpenverse(await res.json(), query);
}

/** Brave first (best logo coverage); Openverse when there is no key, Brave fails or finds nothing. */
export async function searchImages(query: string, signal?: AbortSignal): Promise<{ provider: SearchProvider; candidates: Candidate[] }> {
  const key = process.env["BRAVE_API_KEY"];
  if (key) {
    try {
      const candidates = await braveSearch(query, key, signal);
      if (candidates.length) return { provider: "brave", candidates };
    } catch (e) {
      signal?.throwIfAborted();
      console.error(e);
    }
  }
  return { provider: "openverse", candidates: await openverseSearch(query, signal) };
}

/** A thumbnail as a data URL — only from the search providers' image hosts. */
export async function fetchThumb(url: string, signal?: AbortSignal): Promise<string> {
  if (!isAllowedImageUrl(url)) throw new Error("Image host not allowed");
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "image/avif,image/webp,image/png,image/jpeg,*/*" }, signal: signal ?? null, redirect: "follow" });
  const type = (res.headers.get("Content-Type") ?? "").split(";")[0]!.trim();
  if (!res.ok || !/^image\/(png|jpeg|webp|gif)$/.test(type)) throw new Error(`Thumbnail unavailable (${res.status} ${type})`);
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > MAX_THUMB) throw new Error("Thumbnail too large");
  return bytesToDataUrl(new Uint8Array(bytes), type);
}

/** What a reference contributes, for one role, as text (the image models never see it). */
export async function describeReference(image: string, role: ReferenceRole, signal?: AbortSignal) {
  const text = await openaiText({
    instructions: referenceInstructions(role),
    content: [{ type: "input_image", image_url: image, detail: role === "typography" || role === "style" ? "high" : "low" }],
    signal,
  });
  return text.slice(0, 600);
}

/**
 * `samples`: thumbnails (data URLs) of the visual search's logos, so the browser can measure the
 * colours real brands in this space use (palette.ts). Shown nowhere, stored nowhere.
 */
export type FoundReferences = { provider: SearchProvider; references: AutoReference[]; candidates: Candidate[]; samples: string[] };

/**
 * Searches, lets the cheap vision model pick the best image per role, and describes each pick for
 * its role only. `exclude` skips candidates the user removed; `roles` limits which roles to fill.
 */
export async function findReferences(brief: LogoBrief, opts: { exclude?: string[]; roles?: ReferenceRole[]; signal?: AbortSignal } = {}): Promise<FoundReferences> {
  const { signal } = opts;
  const exclude = new Set(opts.exclude ?? []);
  const queries = referenceQueries(brief)
    .map((q) => ({ ...q, roles: q.roles.filter((r) => !opts.roles || opts.roles.includes(r)) }))
    .filter((q) => q.roles.length);
  if (!queries.length) return { provider: "openverse", references: [], candidates: [], samples: [] };
  const searches = await Promise.all(queries.map((q) => searchImages(q.query, signal)));
  const provider = searches.some((s) => s.provider === "brave") ? "brave" : "openverse";
  const all = searches.flatMap((s) => s.candidates);

  // The picker sees each search's top results that loaded, as small images.
  const groups = await Promise.all(
    queries.map(async (q, i) => {
      const top = searches[i]!.candidates.filter((c) => !exclude.has(c.id)).slice(0, PICK_PER_QUERY);
      const loaded = await Promise.all(top.map(async (c) => ({ c, image: await fetchThumb(c.thumb, signal).catch(() => "") })));
      return { roles: q.roles, items: loaded.filter((x) => x.image) };
    }),
  );
  const flat = groups.flatMap((g) => g.items);
  const samples = (groups.find((g) => g.roles.includes("style")) ?? groups[0])?.items.map((x) => x.image).slice(0, 12) ?? [];
  if (!flat.length) return { provider, references: [], candidates: all, samples };

  const roles = groups.flatMap((g) => (g.items.length ? g.roles : []));
  let picks: { role: ReferenceRole; index: number }[] = [];
  try {
    const raw = await openaiJson({
      instructions: pickInstructions(brief, groups.map((g) => ({ roles: g.roles, count: g.items.length }))),
      content: flat.map((x) => ({ type: "input_image" as const, image_url: x.image, detail: "low" as const })),
      schema: PICK_SCHEMA,
      name: "reference_picks",
      signal,
    });
    picks = readPicks(raw, roles, flat.length);
  } catch (e) {
    signal?.throwIfAborted();
    console.error("reference pick failed", e);
    // Fall back to each search's first results, one per role.
    let offset = 0;
    for (const g of groups) {
      g.roles.forEach((role, k) => { if (k < g.items.length) picks.push({ role, index: offset + k }); });
      offset += g.items.length;
    }
  }

  const references = (
    await Promise.all(
      picks.map(async ({ role, index }) => {
        const pick = flat[index]!;
        const description = await describeReference(pick.image, role, signal).catch(() => "");
        return description ? { role, description, image: pick.image, candidate: pick.c } : null;
      }),
    )
  ).filter((r): r is AutoReference => Boolean(r));
  return { provider, references, candidates: all, samples };
}

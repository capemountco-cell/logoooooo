import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeBrief } from "@/lib/brief";
import { isAllowedImageUrl, parseBrave, parseOpenverse, readPicks, readSearchPlan, referenceQueries, SEARCH_PLAN_INSTRUCTIONS } from "@/lib/reference-search";
import { Route as ReferencesRoute } from "@/routes/api/references";
import { Route as NoteRoute } from "@/routes/api/reference-note";

type Handler = (ctx: { request: Request }) => Promise<Response>;
const post = (route: unknown) => (route as { options: { server: { handlers: { POST: Handler } } } }).options.server.handlers.POST;

const bakery = normalizeBrief({ brandName: "Fernwood Bakery", logoType: "combination", industry: "sourdough bakery", personality: ["warm", "hand-crafted"], symbolIdeas: ["a fern"], typography: "warm serif", summary: "A warm bakery logo." });

describe("reference queries", () => {
  it("builds a visual search and, when the logo has lettering, a typography search", () => {
    expect(referenceQueries(bakery)).toEqual([
      { query: "a fern warm hand-crafted logo design", roles: ["style", "concept"] },
      { query: "warm serif logotype lettering", roles: ["typography"] },
    ]);
    const symbol = referenceQueries(normalizeBrief({ ...bakery, logoType: "pictorial" }));
    expect(symbol).toHaveLength(1);
    expect(symbol[0]!.query).toContain("icon logo");
  });
});

describe("provider results", () => {
  it("keeps only thumbnails on the providers' image hosts", () => {
    const brave = parseBrave({ results: [
      { title: "Fern logo", url: "https://pinterest.com/pin/1", thumbnail: { src: "https://imgs.search.brave.com/abc" } },
      { title: "Bad", url: "https://x.com", thumbnail: { src: "https://evil.example/img.png" } },
    ] }, "q");
    expect(brave).toHaveLength(1);
    expect(brave[0]).toMatchObject({ thumb: "https://imgs.search.brave.com/abc", source: "https://pinterest.com/pin/1", provider: "brave" });
    const ov = parseOpenverse({ results: [{ id: "u1", title: "Leaf", thumbnail: "https://api.openverse.org/v1/images/u1/thumb/", foreign_landing_url: "https://flickr.com/1" }] }, "q");
    expect(ov[0]).toMatchObject({ id: "o:u1", provider: "openverse" });
    expect(isAllowedImageUrl("http://imgs.search.brave.com/a")).toBe(false);
    expect(isAllowedImageUrl("https://imgs.search.brave.com.evil.com/a")).toBe(false);
  });

  it("validates the picker: known roles, in range, one image per role", () => {
    const picks = readPicks({ picks: [{ role: "style", index: 2 }, { role: "concept", index: 2 }, { role: "typography", index: 9 }, { role: "colour", index: 1 }, { role: "concept", index: 0 }] }, ["style", "concept", "typography"], 5);
    expect(picks).toEqual([{ role: "style", index: 2 }, { role: "concept", index: 0 }]);
    expect(readPicks(null, ["style"], 3)).toEqual([]);
  });
});

// A tiny valid PNG served as every thumbnail.
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
let calls: string[] = [];
let pickInputs: unknown[] = [];
function mockNet(opts: { braveStatus?: number; plan?: unknown } = {}) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(url);
    if (url.startsWith("https://api.search.brave.com/")) {
      if (opts.braveStatus) return new Response("no", { status: opts.braveStatus });
      const q = new URL(url).searchParams.get("q") ?? "";
      return Response.json({ results: Array.from({ length: 4 }, (_, i) => ({ title: `logo ${i}`, url: `https://pinterest.com/pin/${i}`, thumbnail: { src: `https://imgs.search.brave.com/${encodeURIComponent(q)}/t${i}` } })) });
    }
    if (url.startsWith("https://api.openverse.org/v1/images/?")) {
      return Response.json({ results: Array.from({ length: 3 }, (_, i) => ({ id: `id${i}`, title: `cc ${i}`, thumbnail: `https://api.openverse.org/v1/images/id${i}/thumb/`, foreign_landing_url: `https://flickr.com/${i}` })) });
    }
    if (url.startsWith("https://imgs.search.brave.com/") || url.includes("/thumb/")) return new Response(PNG, { headers: { "Content-Type": "image/png" } });
    if (url === "https://api.openai.com/v1/responses") {
      const body = JSON.parse(String(init?.body)) as { text?: { format?: { name?: string } }; instructions?: string; input?: unknown };
      const name = body.text?.format?.name;
      if (name === "reference_picks") pickInputs.push(body);
      const text =
        name === "reference_searches" ? JSON.stringify(opts.plan ?? { queries: [] })
          : name ? JSON.stringify({ picks: [{ role: "style", index: 0 }, { role: "concept", index: 1 }, { role: "typography", index: 4 }] })
            : "geometric, generous negative space";
      return Response.json({ output: [{ type: "message", content: [{ type: "output_text", text }] }] });
    }
    return new Response("unexpected", { status: 500 });
  }));
}
const json = (body: unknown) => new Request("http://localhost/api/references", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  calls = [];
  pickInputs = [];
  process.env["OPENAI_API_KEY"] = "test";
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env["BRAVE_API_KEY"];
});

describe("/api/references", () => {
  it("uses Brave when a key is set, picks one image per role and describes each for its role", async () => {
    process.env["BRAVE_API_KEY"] = "k";
    mockNet();
    const res = await post(ReferencesRoute)({ request: json({ brief: bakery }) });
    const out = (await res.json()) as { provider: string; references: { role: string; description: string; image: string; candidate: { source: string } }[]; candidates: unknown[] };
    expect(out.provider).toBe("brave");
    expect(out.references.map((r) => r.role)).toEqual(["style", "concept", "typography"]);
    expect(out.references[0]!.image.startsWith("data:image/png;base64,")).toBe(true);
    expect(out.references[2]!.candidate.source).toBe("https://pinterest.com/pin/0");
    expect(out.candidates).toHaveLength(8);
    expect(calls.filter((c) => c.startsWith("https://api.search.brave.com/"))).toHaveLength(2);
    expect(calls.some((c) => c.startsWith("https://api.openverse.org/v1/images/?"))).toBe(false);
  });

  it("falls back to Openverse without a key, and when Brave fails", async () => {
    mockNet();
    const free = (await (await post(ReferencesRoute)({ request: json({ brief: bakery }) })).json()) as { provider: string };
    expect(free.provider).toBe("openverse");
    calls = [];
    process.env["BRAVE_API_KEY"] = "k";
    mockNet({ braveStatus: 429 });
    const fell = (await (await post(ReferencesRoute)({ request: json({ brief: bakery }) })).json()) as { provider: string; references: unknown[] };
    expect(fell.provider).toBe("openverse");
    expect(fell.references.length).toBeGreaterThan(0);
  });

  it("skips candidates the user removed", async () => {
    process.env["BRAVE_API_KEY"] = "k";
    mockNet();
    const exclude = ["b:a fern warm hand-crafted logo design:0"];
    const out = (await (await post(ReferencesRoute)({ request: json({ brief: bakery, exclude, roles: ["style"] }) })).json()) as { references: { candidate: { id: string } }[] };
    expect(out.references.every((r) => !exclude.includes(r.candidate.id))).toBe(true);
    expect(calls.filter((c) => c.startsWith("https://api.search.brave.com/"))).toHaveLength(1);
  });
});

describe("/api/reference-note", () => {
  it("describes an allowlisted thumbnail and refuses any other host", async () => {
    mockNet();
    const ok = new FormData();
    ok.append("role", "typography");
    ok.append("url", "https://imgs.search.brave.com/t1");
    const res = await post(NoteRoute)({ request: new Request("http://localhost/api/reference-note", { method: "POST", body: ok }) });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { description: string }).description).toContain("geometric");
    const bad = new FormData();
    bad.append("role", "style");
    bad.append("url", "https://169.254.169.254/latest/meta-data");
    expect((await post(NoteRoute)({ request: new Request("http://localhost/api/reference-note", { method: "POST", body: bad }) })).status).toBe(400);
    expect(calls.some((c) => c.includes("169.254"))).toBe(false);
  });
});

describe("searching like a designer", () => {
  it("plans visual-language searches that cover every role, and drops unusable plans", () => {
    const plan = readSearchPlan({ queries: [{ query: "chunky hand-lettered brush wordmark dribbble", roles: ["typography"] }, { query: "bold retro badge emblem logo behance", roles: ["style", "concept"] }, { query: "x", roles: ["style"] }] }, ["style", "concept", "typography"]);
    expect(plan).toEqual([{ query: "chunky hand-lettered brush wordmark dribbble", roles: ["typography"] }, { query: "bold retro badge emblem logo behance", roles: ["style", "concept"] }]);
    expect(readSearchPlan({ queries: [{ query: "bold retro badge logo", roles: ["style"] }] }, ["style", "typography"])).toEqual([]);
    expect(SEARCH_PLAN_INSTRUCTIONS).toMatch(/not the literal subject/);
    expect(SEARCH_PLAN_INSTRUCTIONS).toMatch(/dribbble/);
  });

  it("lets the picker build a small moodboard: two style references, one for each other role", () => {
    const picks = readPicks({ picks: [{ role: "style", index: 0 }, { role: "style", index: 1 }, { role: "style", index: 2 }, { role: "typography", index: 3 }] }, ["style", "typography"], 5);
    expect(picks).toEqual([{ role: "style", index: 0 }, { role: "style", index: 1 }, { role: "typography", index: 3 }]);
  });

  it("runs the planned searches on Brave and offers the designer's saved references to the picker first", async () => {
    process.env["BRAVE_API_KEY"] = "k";
    mockNet({ plan: { queries: [{ query: "hand-lettered brush wordmark dribbble", roles: ["typography"] }, { query: "warm rustic bakery badge behance", roles: ["style", "concept"] }] } });
    const saved = { id: "fav1", image: "data:image/png;base64,iVBORw0KGgo=", role: "style", note: "my favourite badge" };
    const out = (await (await post(ReferencesRoute)({ request: json({ brief: bakery, library: [saved, { id: "bad", image: "https://evil.example/x.png", role: "style", note: "" }] }) })).json()) as { references: { role: string; candidate?: unknown }[] };
    const searched = calls.filter((c) => c.startsWith("https://api.search.brave.com/")).map((c) => new URL(c).searchParams.get("q"));
    expect(searched).toEqual(["hand-lettered brush wordmark dribbble", "warm rustic bakery badge behance"]);
    const pick = JSON.stringify(pickInputs[0]);
    expect(pick).toContain("THE DESIGNER'S OWN SAVED REFERENCES");
    expect(pick).toContain("JUDGE LIKE A DESIGNER");
    expect(pick).not.toContain("evil.example");
    // Index 0 is the saved reference: it comes back without a search candidate.
    expect(out.references[0]).toMatchObject({ role: "style" });
    expect(out.references[0]!.candidate).toBeUndefined();
  });
});

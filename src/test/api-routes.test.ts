import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route as BriefRoute } from "@/routes/api/brief";
import { Route as ConceptRoute } from "@/routes/api/concept";
import { Route as ReviewRoute } from "@/routes/api/review";
import { Route as PlanRoute } from "@/routes/api/concept-plan";
import { normalizeBrief } from "@/lib/brief";
import { isRetryable } from "@/lib/concept-pipeline";

type Handler = (ctx: { request: Request }) => Promise<Response>;
const post = (route: unknown) => (route as { options: { server: { handlers: { POST: Handler } } } }).options.server.handlers.POST;

const brief = normalizeBrief({ brandName: "Ember", logoType: "wordmark", summary: "A cosy coffee shop logo.", personality: ["cosy"] });
const png = () => new File([new Uint8Array([137, 80, 78, 71])], "x.png", { type: "image/png" });
const request = (path: string, form: FormData) => new Request(`http://localhost${path}`, { method: "POST", body: form });

let calls: { url: string; body: unknown }[] = [];
function mockFetch(reply: (url: string, body: unknown) => Response) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
    calls.push({ url, body });
    return reply(url, body);
  }));
}
const responses = (obj: unknown) => Response.json({ output: [{ type: "message", content: [{ type: "output_text", text: typeof obj === "string" ? obj : JSON.stringify(obj) }] }] });

beforeEach(() => {
  calls = [];
  process.env["OPENAI_API_KEY"] = "test-openai";
  process.env["XAI_API_KEY"] = "test-xai";
});
afterEach(() => vi.unstubAllGlobals());

describe("/api/brief", () => {
  it("reads each reference for its role only, then writes a structured brief with the cheapest model", async () => {
    mockFetch((_u, body) => {
      const b = body as { text?: unknown };
      return b.text ? responses({ ...brief, logoType: "combination" }) : responses("rounded geometric sans, lowercase");
    });
    const form = new FormData();
    form.append("notes", "ember coffee, cosy");
    form.append("role0", "typography");
    form.append("ref0", png());
    form.append("role1", "colour");
    form.append("ref1", png());
    form.append("palette1", "#c2410c, #1f2937");
    const res = await post(BriefRoute)({ request: request("/api/brief", form) });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { brief: { logoType: string }; references: { role: string; description: string }[] };
    expect(json.brief.logoType).toBe("combination");
    // Colour comes from measured pixels, so only the typography reference goes to the vision model.
    expect(calls).toHaveLength(2);
    const [vision, cleanup] = calls.map((c) => c.body as Record<string, unknown>);
    expect(vision!["model"]).toBe("gpt-5-nano");
    expect(String(vision!["instructions"])).toContain("ONLY its lettering");
    expect(cleanup!["model"]).toBe("gpt-5-nano");
    expect((cleanup!["text"] as { format: { type: string; strict: boolean } }).format).toMatchObject({ type: "json_schema", strict: true });
    expect(JSON.stringify(cleanup!["input"])).toContain("Use for TYPOGRAPHY only: rounded geometric sans");
    expect(json.references[1]).toEqual({ role: "colour", description: "Use this palette: #c2410c, #1f2937." });
  });

  it("strips pasted web-page clutter before the brief model reads it", async () => {
    mockFetch(() => responses(brief));
    const form = new FormData();
    form.append("notes", "Skip to content\nHome\nServices\nPortfolio\nContact\nLogo for Fernwood Bakery, a sourdough bakery in Leeds.\nPrivacy Policy\n© 2026 Example Ltd. All rights reserved.\nhttps://example.com");
    await post(BriefRoute)({ request: request("/api/brief", form) });
    const sent = JSON.stringify((calls[0]!.body as { input: unknown }).input);
    expect(sent).toContain("Logo for Fernwood Bakery, a sourdough bakery in Leeds.");
    for (const junk of ["Skip to content", "Portfolio", "Privacy Policy", "All rights reserved", "https://example.com"]) expect(sent).not.toContain(junk);
    expect(String((calls[0]!.body as { instructions: string }).instructions)).toContain("PASTED PAGES");
  });

  it("rejects an empty brief and passes rate limits through for retry", async () => {
    const empty = new FormData();
    empty.append("notes", "");
    expect((await post(BriefRoute)({ request: request("/api/brief", empty) })).status).toBe(400);
    mockFetch(() => new Response('{"error":{"code":"rate_limit_exceeded"}}', { status: 429, headers: { "retry-after-ms": "1" } }));
    const form = new FormData();
    form.append("notes", "ember coffee");
    const res = await post(BriefRoute)({ request: request("/api/brief", form) });
    expect(res.status).toBe(429);
    // Retried on the server first (1 try + 3 retries), with an honest message (no false "retrying").
    expect(calls).toHaveLength(4);
    expect(await res.text()).toMatch(/rate-limiting this API key/);
  });

  it("recovers when a rate limit clears on retry", async () => {
    let n = 0;
    mockFetch(() => (n++ === 0 ? new Response("{}", { status: 429, headers: { "retry-after-ms": "1" } }) : responses(brief)));
    const form = new FormData();
    form.append("notes", "ember coffee");
    expect((await post(BriefRoute)({ request: request("/api/brief", form) })).status).toBe(200);
    expect(calls).toHaveLength(2);
  });

  it("says plainly when the OpenAI account has no credit, and never retries it", async () => {
    mockFetch(() => new Response('{"error":{"message":"You exceeded your current quota","type":"insufficient_quota","code":"insufficient_quota"}}', { status: 429 }));
    const form = new FormData();
    form.append("notes", "ember coffee");
    const res = await post(BriefRoute)({ request: request("/api/brief", form) });
    expect(res.status).toBe(402);
    expect(calls).toHaveLength(1);
    expect(await res.text()).toMatch(/out of credit.*Billing/);
  });

  it("names a rejected API key", async () => {
    mockFetch(() => new Response('{"error":{"code":"invalid_api_key"}}', { status: 401 }));
    const form = new FormData();
    form.append("notes", "ember coffee");
    const res = await post(BriefRoute)({ request: request("/api/brief", form) });
    expect(res.status).toBe(401);
    expect(await res.text()).toMatch(/OPENAI_API_KEY/);
  });
});

describe("/api/concept", () => {
  const form = (extra: Record<string, string | File>) => {
    const f = new FormData();
    f.append("brief", JSON.stringify(brief));
    f.append("references", "[]");
    for (const [k, v] of Object.entries(extra)) f.append(k, v);
    return f;
  };

  it("builds the prompt on the server and generates with gpt-image-2", async () => {
    mockFetch(() => new Response("event: x\n\n", { headers: { "Content-Type": "text/event-stream" } }));
    const res = await post(ConceptRoute)({ request: request("/api/concept", form({ provider: "openai", index: "2" })) });
    expect(res.status).toBe(200);
    expect(calls[0]!.url).toBe("https://api.openai.com/v1/images/generations");
    const body = calls[0]!.body as { model: string; prompt: string; stream: boolean };
    expect(body.model).toBe("gpt-image-2");
    expect(body.prompt).toContain('the brand name "Ember" exactly once');
    expect(body.prompt).toContain("concept 3)");
    expect(body.stream).toBe(true);
  });

  it("turns an out-of-credit image error into a clear 402 the concept loop won't retry", async () => {
    mockFetch(() => new Response('{"error":{"code":"insufficient_quota"}}', { status: 429 }));
    const res = await post(ConceptRoute)({ request: request("/api/concept", form({ provider: "openai" })) });
    expect(res.status).toBe(402);
    const msg = `${res.status} ${await res.text()}`;
    expect(isRetryable(new Error(msg))).toBe(false);
    expect(isRetryable(new Error("429 OpenAI is rate-limiting this API key"))).toBe(true);
  });

  it("uses Grok text-to-image, and Grok edits for fixes", async () => {
    mockFetch(() => Response.json({ data: [{ b64_json: "QUJD" }] }));
    const gen = await post(ConceptRoute)({ request: request("/api/concept", form({ provider: "grok", index: "1" })) });
    expect(calls[0]!.url).toBe("https://api.x.ai/v1/images/generations");
    expect((calls[0]!.body as { model: string }).model).toBe("grok-imagine-image");
    expect(await gen.text()).toContain("image_generation.completed");
    const fix = await post(ConceptRoute)({ request: request("/api/concept", form({ provider: "grok", image: png(), issues: JSON.stringify(["Make the 'm' complete"]) })) });
    expect(fix.status).toBe(200);
    expect(calls[1]!.url).toBe("https://api.x.ai/v1/images/edits");
    expect((calls[1]!.body as { prompt: string }).prompt).toContain("1. Make the 'm' complete");
  });

  it("rejects Gemini and other unknown providers", async () => {
    expect((await post(ConceptRoute)({ request: request("/api/concept", form({ provider: "gemini" })) })).status).toBe(400);
  });
});

describe("/api/review", () => {
  it("grades with structured output and overrides a spelling pass the reviewer didn't read", async () => {
    mockFetch(() => responses({ textSeen: "Embr", checks: ["spelling", "extra_text", "type", "brief", "flat", "quality"].map((id) => ({ id, pass: true, issue: "" })) }));
    const f = new FormData();
    f.append("image", png());
    f.append("brief", JSON.stringify(brief));
    f.append("references", "[]");
    const res = await post(ReviewRoute)({ request: request("/api/review", f) });
    const json = (await res.json()) as { results: { id: string; pass: boolean }[] };
    expect((calls[0]!.body as { model: string }).model).toBe("gpt-5-nano");
    expect(json.results.find((r) => r.id === "spelling")?.pass).toBe(false);
    expect(json.results.filter((r) => r.pass)).toHaveLength(5);
  });
});

describe("/api/concept-plan", () => {
  const json = (body: unknown) => new Request("http://localhost/api/concept-plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  it("plans one different idea per concept with the cheap model and fills any gap", async () => {
    mockFetch(() => responses({ concepts: [{ name: "Aligned arc", idea: "An arc of aligned forms.", symbol: "Three rising arcs", lettering: "Medium humanist sans", color: "Arcs green, text olive", layout: "Arc left of name" }] }));
    const res = await post(PlanRoute)({ request: json({ brief: { ...brief, direction: "a ring with a T" }, references: [], count: 3, tried: ["Monogram: TFO"] }) });
    expect(res.status).toBe(200);
    const { plans } = (await res.json()) as { plans: { name: string }[] };
    expect(plans).toHaveLength(3);
    expect(plans[0]!.name).toBe("Aligned arc");
    const body = calls[0]!.body as Record<string, unknown>;
    expect(body["model"]).toBe("gpt-5-nano");
    expect((body["text"] as { format: { name: string; strict: boolean } }).format).toMatchObject({ name: "concept_plans", strict: true });
    expect(JSON.stringify(body["input"])).toContain("CLIENT'S EXISTING IDEA (refine in exactly one concept): a ring with a T");
    expect(JSON.stringify(body["input"])).toContain("ALREADY TRIED IN EARLIER ROUNDS");
  });

  it("sends each concept's plan into its drawing prompt as structured fields", async () => {
    mockFetch(() => new Response("event: x\n\n", { headers: { "Content-Type": "text/event-stream" } }));
    const f = new FormData();
    f.append("brief", JSON.stringify(brief));
    f.append("references", "[]");
    f.append("provider", "openai");
    f.append("plan", JSON.stringify({ name: "Ember spark", idea: "A spark that is also a coffee bean.", symbol: "Bean-shaped spark", lettering: "Bold rounded sans", color: "Spark orange, text charcoal", layout: "Spark above name" }));
    await post(ConceptRoute)({ request: request("/api/concept", f) });
    expect((calls[0]!.body as { prompt: string }).prompt).toContain("CONCEPT 1 — EMBER SPARK: A spark that is also a coffee bean.");
  });
});

describe("/api/concept with reference pictures", () => {
  const withRefs = (extra: Record<string, string | File>) => {
    const f = new FormData();
    f.append("brief", JSON.stringify(brief));
    f.append("references", JSON.stringify([{ role: "typography", description: "bold hand-drawn brush lettering" }]));
    for (const [k, v] of Object.entries(extra)) f.append(k, v);
    return f;
  };

  it("shows the image model each reference picture for its role (edit endpoint), like ChatGPT", async () => {
    mockFetch(() => new Response("event: x\n\n", { headers: { "Content-Type": "text/event-stream" } }));
    const res = await post(ConceptRoute)({ request: request("/api/concept", withRefs({ provider: "openai", refImage0: png(), refRole0: "typography", refImage1: png(), refRole1: "style" })) });
    expect(res.status).toBe(200);
    expect(calls[0]!.url).toBe("https://api.openai.com/v1/images/edits");
    const sent = calls[0]!.body as FormData;
    expect(sent.getAll("image[]")).toHaveLength(2);
    const prompt = String(sent.get("prompt"));
    expect(prompt).toContain("VISUAL REFERENCES: The 2 images provided are reference pictures");
    expect(prompt).toContain("Image 1 (TYPOGRAPHY): take ONLY its lettering style");
    expect(prompt).toContain("Image 2 (STYLE): take ONLY its visual style");
    expect(prompt).toContain("Never reproduce a reference's symbol, wording, layout or overall design");
    expect(prompt).toContain('the brand name "Ember" exactly once');
  });

  it("draws from text alone without pictures, and Grok never gets them", async () => {
    mockFetch(() => new Response("event: x\n\n", { headers: { "Content-Type": "text/event-stream" } }));
    await post(ConceptRoute)({ request: request("/api/concept", withRefs({ provider: "openai" })) });
    expect(calls[0]!.url).toBe("https://api.openai.com/v1/images/generations");
    expect((calls[0]!.body as { prompt: string }).prompt).not.toContain("VISUAL REFERENCES");
    mockFetch(() => Response.json({ data: [{ b64_json: "QUJD" }] }));
    calls = [];
    await post(ConceptRoute)({ request: request("/api/concept", withRefs({ provider: "grok", refImage0: png(), refRole0: "style" })) });
    expect(calls[0]!.url).toBe("https://api.x.ai/v1/images/generations");
  });

  it("refuses unknown roles and non-image files", async () => {
    mockFetch(() => new Response("{}"));
    expect((await post(ConceptRoute)({ request: request("/api/concept", withRefs({ provider: "openai", refImage0: png(), refRole0: "everything" })) })).status).toBe(400);
    const txt = new File(["hi"], "x.txt", { type: "text/plain" });
    expect((await post(ConceptRoute)({ request: request("/api/concept", withRefs({ provider: "openai", refImage0: txt, refRole0: "style" })) })).status).toBe(400);
  });
});

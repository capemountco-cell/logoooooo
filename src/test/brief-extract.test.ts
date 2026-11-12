import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXTRACT_INSTRUCTIONS, TILE, tileRects } from "@/lib/brief-extract";
import { Route } from "@/routes/api/brief-extract";

type Handler = (ctx: { request: Request }) => Promise<Response>;
const post = (Route as unknown as { options: { server: { handlers: { POST: Handler } } } }).options.server.handlers.POST;

describe("screenshot sections", () => {
  it("keeps short screenshots whole and cuts tall ones into overlapping sections that cover everything", () => {
    expect(tileRects(900)).toEqual([{ y: 0, height: 900 }]);
    const rects = tileRects(6000);
    expect(rects.length).toBeGreaterThan(4);
    expect(rects[0]!.y).toBe(0);
    const last = rects[rects.length - 1]!;
    expect(last.y + last.height).toBe(6000);
    for (let i = 1; i < rects.length; i++) expect(rects[i]!.y).toBeLessThan(rects[i - 1]!.y + rects[i - 1]!.height - TILE.overlap / 2);
  });

  it("never exceeds the section limit on very long captures (taller sections instead)", () => {
    const rects = tileRects(40_000);
    expect(rects.length).toBeLessThanOrEqual(TILE.max);
    expect(rects[rects.length - 1]!.y + rects[rects.length - 1]!.height).toBe(40_000);
  });

  it("asks for the brief itself, with exact names and slider positions, and ignores the platform", () => {
    expect(EXTRACT_INSTRUCTIONS).toContain("EXACTLY as written");
    expect(EXTRACT_INSTRUCTIONS).toContain("Classic ↔ Modern");
    expect(EXTRACT_INSTRUCTIONS).toContain("prices and prize badges");
  });
});

let bodies: Record<string, unknown>[] = [];
beforeEach(() => {
  bodies = [];
  process.env["OPENAI_API_KEY"] = "test";
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    return Response.json({ output: [{ type: "message", content: [{ type: "output_text", text: "Name: AK Cards\nIndustry: Retail" }] }] });
  }));
});
afterEach(() => vi.unstubAllGlobals());

const req = (files: File[]) => {
  const form = new FormData();
  for (const f of files) form.append("file", f);
  return new Request("http://localhost/api/brief-extract", { method: "POST", body: form });
};

describe("/api/brief-extract", () => {
  it("reads screenshot sections in order at high detail", async () => {
    const parts = [1, 2, 3].map((i) => new File([new Uint8Array([i])], `brief-${i}.jpg`, { type: "image/jpeg" }));
    const res = await post({ request: req(parts) });
    expect(await res.json()).toEqual({ text: "Name: AK Cards\nIndustry: Retail" });
    const content = (bodies[0]!["input"] as { content: { type: string; detail?: string; image_url?: string }[] }[])[0]!.content;
    expect(content).toHaveLength(3);
    expect(content.every((c) => c.type === "input_image" && c.detail === "high")).toBe(true);
    expect(content[0]!.image_url).toBe("data:image/jpeg;base64,AQ==");
    expect(bodies[0]!["model"]).toBe("gpt-5-nano");
  });

  it("sends a PDF whole, and rejects other files", async () => {
    await post({ request: req([new File([new Uint8Array([37, 80, 68, 70])], "brief.pdf", { type: "application/pdf" })]) });
    const content = (bodies[0]!["input"] as { content: { type: string; filename?: string }[] }[])[0]!.content;
    expect(content[0]).toMatchObject({ type: "input_file", filename: "brief.pdf" });
    expect((await post({ request: req([new File(["x"], "a.zip", { type: "application/zip" })]) })).status).toBe(400);
    expect((await post({ request: req([]) })).status).toBe(400);
  });
});

import { describe, expect, it } from "vitest";
import { BUDGET, isRetryable, runConcept, type ConceptDeps, type DrawRequest } from "@/lib/concept-pipeline";
import type { CheckDef, CheckResult } from "@/lib/concept-prompt";

const checks: CheckDef[] = [
  { id: "background", label: "Clean background", by: "code" },
  { id: "spelling", label: "Text spelled exactly", by: "ai" },
];
const ok = (id: CheckResult["id"]): CheckResult => ({ id, pass: true, issue: "" });
const bad = (id: CheckResult["id"], issue: string): CheckResult => ({ id, pass: false, issue });

function harness(plan: { auto: (src: string) => CheckResult[]; review: (src: string) => CheckResult[]; drawError?: (n: number) => Error | null }) {
  const draws: DrawRequest[] = [];
  const stages: string[] = [];
  let t = 0;
  const deps: ConceptDeps = {
    draw: async (req, onFrame) => {
      const err = plan.drawError?.(draws.length);
      draws.push(req);
      if (err) throw err;
      const src = `img${draws.length}`;
      onFrame(src);
      return src;
    },
    auto: async (src) => plan.auto(src),
    review: async (src) => plan.review(src),
    wait: async () => {},
    now: () => (t += 1000),
  };
  return { deps, draws, stages, run: () => runConcept({ provider: "openai", index: 0, checks }, deps, new AbortController().signal, (s) => stages.push(s.stage)) };
}

describe("concept hand-off loop", () => {
  it("shows a concept that passes every box first time", async () => {
    const h = harness({ auto: () => [ok("background")], review: () => [ok("spelling")] });
    const s = await h.run();
    expect(s.stage).toBe("passed");
    expect(s.image).toBe("img1");
    expect(h.draws).toHaveLength(1);
    expect(h.stages).toContain("checking");
  });

  it("sends only the failed boxes back as fixes, then passes", async () => {
    const h = harness({ auto: () => [ok("background")], review: (src) => (src === "img1" ? [bad("spelling", "Second letter reads 'c' — make it 'o'")] : [ok("spelling")]) });
    const s = await h.run();
    expect(s.stage).toBe("passed");
    expect(s.fixes).toBe(1);
    expect(h.draws[1]).toEqual({ provider: "openai", index: 0, draft: "img1", issues: ["Second letter reads 'c' — make it 'o'"] });
  });

  it("starts over with a fresh drawing when fixing runs out, and never shows a failing concept", async () => {
    const h = harness({ auto: () => [bad("background", "Make it white")], review: () => [ok("spelling")] });
    const s = await h.run();
    expect(s.stage).toBe("failed");
    // (1 drawing + 2 fixes) × (1 + 1 redraw)
    expect(h.draws).toHaveLength((1 + BUDGET.fixes) * (1 + BUDGET.redraws));
    expect(h.draws.filter((d) => !d.draft)).toHaveLength(1 + BUDGET.redraws);
    expect(h.stages).toContain("redrawing");
  });

  it("passes after a fresh redraw", async () => {
    const h = harness({ auto: (src) => [src === "img4" ? ok("background") : bad("background", "x")], review: () => [ok("spelling")] });
    const s = await h.run();
    expect(s.stage).toBe("passed");
    expect(s.image).toBe("img4");
    expect(s.redraws).toBe(1);
  });

  it("treats a missing check result as not passed", async () => {
    const h = harness({ auto: () => [ok("background")], review: () => [] });
    expect((await h.run()).stage).toBe("failed");
  });

  it("retries rate limits with backoff but gives up on real errors", async () => {
    const h = harness({ auto: () => [ok("background")], review: () => [ok("spelling")], drawError: (n) => (n < 2 ? new Error("Image generation failed: 429 busy") : null) });
    const s = await h.run();
    expect(s.stage).toBe("passed");
    expect(h.stages).toContain("waiting");
    const h2 = harness({ auto: () => [ok("background")], review: () => [ok("spelling")], drawError: () => new Error("Image generation failed: 500 Missing Grok key") });
    const s2 = await h2.run();
    expect(s2.stage).toBe("failed");
    expect(s2.note).toBe("500 Missing Grok key");
    expect(h2.draws).toHaveLength(1);
    expect(isRetryable(new Error("Failed to fetch"))).toBe(true);
  });
});

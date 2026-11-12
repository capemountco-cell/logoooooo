import { describe, expect, it } from "vitest";
import { loadSaved, restoreSnapshot, saveSaved } from "@/lib/persist";

const concept = (index: number, stage: string) => ({ provider: "openai", index, stage, image: `img${index}`, results: [], fixes: 0, redraws: 0, note: "" });

describe("autosave", () => {
  it("brings back a job without restarting it: unfinished concepts become Interrupted", () => {
    const snap = restoreSnapshot({
      v: 1, phase: "generating", brief: { brandName: "AK Cards" }, references: [], refs: [], candidates: [], provider: null, picked: false,
      rounds: [{ id: "r1", checks: [], refs: [], concepts: [concept(0, "passed"), concept(1, "drawing"), concept(2, "fixing")] }],
    })!;
    expect(snap.phase).toBe("done");
    expect(snap.picked).toBe(true);
    expect(snap.rounds[0]!.concepts.map((c) => c.stage)).toEqual(["passed", "failed", "failed"]);
    expect(snap.rounds[0]!.concepts[1]!.note).toBe("Interrupted");
    expect(snap.rounds[0]!.concepts[1]!.image).toBe("img1"); // still viewable with "Show anyway"
  });

  it("comes back idle from a half-read brief, and ignores anything that isn't a snapshot", () => {
    expect(restoreSnapshot({ v: 1, phase: "briefing", brief: null, rounds: [] })!.phase).toBe("idle");
    expect(restoreSnapshot(null)).toBeNull();
    expect(restoreSnapshot({ v: 2, rounds: [] })).toBeNull();
  });

  it("never throws where storage is unavailable", async () => {
    await expect(saveSaved("k", { a: 1 })).resolves.toBeUndefined();
    await expect(loadSaved("k")).resolves.toBeUndefined();
  });
});

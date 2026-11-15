import { describe, expect, it } from "vitest";
import { normalizeBrief } from "@/lib/brief";
import { fallbackPlans, normalizePlan, PLAN_INSTRUCTIONS, planInput, readPlans } from "@/lib/concept-plan";
import { buildConceptPrompt, buildReviewPrompt, checklist, paletteLine } from "@/lib/concept-prompt";

const taut = normalizeBrief({
  brandName: "Taut Family Orthodontics",
  logoType: "combination",
  personality: ["calm", "warm", "grounded", "confident"],
  colors: ["#9CAF88", "#636B2F", "#575799"],
  avoid: ["cartoon teeth", "tooth icons", "generic dental blue"],
  direction: "a thin gold line ring with a capital T in the center, set in a thin sans-serif",
  story: "A small independent orthodontic practice in Plymouth, Michigan run by Dr. Andrei Taut. Every family sees the same doctor; it should feel like a premium wellness studio, not a dental clinic.",
  summary: "A calm, earthy combination mark for a boutique family orthodontic practice.",
});

describe("concept planning", () => {
  it("treats the client's existing idea as one option, not a rule for every concept", () => {
    expect(PLAN_INSTRUCTIONS).toMatch(/exactly ONE concept refines it/);
    expect(planInput(taut, [], 3)).toContain("CLIENT'S EXISTING IDEA (refine in exactly one concept): a thin gold line ring");
    const plans = fallbackPlans(taut, 3);
    expect(plans.map((p) => p.name)).toEqual(["Client idea, refined", "Story symbol", "Monogram"]);
    expect(new Set(plans.map((p) => p.idea)).size).toBe(3);
  });

  it("asks for sturdy weight, type hierarchy and one colour for the lettering", () => {
    expect(PLAN_INSTRUCTIONS).toMatch(/no hairlines/);
    expect(PLAN_INSTRUCTIONS).toMatch(/descriptor words/);
    expect(PLAN_INSTRUCTIONS).toMatch(/All lettering in ONE colour/);
  });

  it("passes earlier rounds' ideas so a new round tries something else", () => {
    expect(planInput(taut, [], 3, ["Monogram: TFO interlocked"])).toContain("ALREADY TRIED IN EARLIER ROUNDS (do something else): Monogram: TFO interlocked");
  });

  it("reads the planner's answer into exactly the asked number of bounded plans", () => {
    const plans = readPlans({ concepts: [{ name: "Aligned arc", idea: "x".repeat(900), symbol: "s", lettering: "l", color: "c", layout: "l" }] }, taut, 3);
    expect(plans).toHaveLength(3);
    expect(plans[0]!.name).toBe("Aligned arc");
    expect(plans[0]!.idea.length).toBe(400);
    expect(normalizePlan({ name: "Only a name" })).toBeNull();
    expect(readPlans("garbage", taut, 2)).toHaveLength(2);
  });

  it("draws each concept from its plan; the client's idea only reaches the one that refines it", () => {
    const [refined, story] = fallbackPlans(taut, 3);
    const p0 = buildConceptPrompt(taut, [], 0, refined);
    const p1 = buildConceptPrompt(taut, [], 1, story);
    expect(p0).toContain("CONCEPT 1 — CLIENT IDEA, REFINED");
    expect(p0).toContain("thin gold line ring");
    expect(p1).toContain("CONCEPT 2 — STORY SYMBOL");
    expect(p1).not.toContain("thin gold line ring");
    expect(p1).toContain("ABOUT THE BRAND: A small independent orthodontic practice");
    expect(p1).toMatch(/WEIGHT: no hairlines/);
    expect(p1).toMatch(/never give different words or letters different colours/);
  });

  it("never asks for a different colour per word", () => {
    expect(paletteLine(taut.colors)).toMatch(/1 to 3 of them, not necessarily all/);
    expect(paletteLine(taut.colors)).toMatch(/never a different colour per word/);
  });
});

describe("bold, illustrative brands (the ChatGPT AlJazeera badge)", () => {
  const aljazeera = normalizeBrief({
    brandName: "AlJazeera",
    tagline: "Lebanese Charcoal Chicken",
    logoType: "emblem",
    alternativeTypes: ["combination", "mascot"],
    industry: "Lebanese charcoal chicken restaurant",
    personality: ["bold", "warm", "fun"],
    summary: "A bold signage-style badge for a charcoal chicken restaurant.",
  });

  it("lets food and hospitality brands be bold, illustrative and literal — not forced minimal", () => {
    expect(PLAN_INSTRUCTIONS).toMatch(/bold emblem or badge \(name, slogan and an illustration/);
    expect(PLAN_INSTRUCTIONS).toMatch(/the chicken, the flame, the dish — is often exactly right/);
    expect(PLAN_INSTRUCTIONS).toMatch(/up to 5 for a bold illustrative one/);
    const p = buildConceptPrompt(aljazeera, [], 0);
    expect(p).toMatch(/food, hospitality, street, sports and craft brands can be bold, illustrative/);
    expect(p).toMatch(/up to 5 flat colours/);
    expect(p).toContain('TAGLINE: Add the tagline "Lebanese Charcoal Chicken"');
  });

  it("follows the client's references when they give some", () => {
    expect(PLAN_INSTRUCTIONS).toMatch(/REFERENCES FIRST/);
    expect(planInput(aljazeera, [{ role: "style", description: "chunky hand-lettered brush wordmark" }], 3)).toContain("REFERENCE NOTES (each only for its role): style: chunky hand-lettered brush wordmark");
  });

  it("never fails a badge as the wrong type when the brief accepts it as an alternative", () => {
    const review = buildReviewPrompt(normalizeBrief({ ...aljazeera, logoType: "combination", alternativeTypes: ["emblem", "mascot"] }), [], checklist(aljazeera, false));
    expect(review).toContain("(accepted alternatives: Emblem, Mascot)");
    expect(review).toContain("requested LOGO TYPE or one of its accepted alternatives");
  });
});

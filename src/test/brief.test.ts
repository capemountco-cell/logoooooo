import { describe, expect, it } from "vitest";
import { BRIEF_INSTRUCTIONS, BRIEF_SCHEMA, DEFAULT_LOGO_TYPE, LOGO_TYPES, normalizeBrief, referenceInstructions, splitBriefs, type LogoBrief } from "@/lib/brief";
import {
  buildConceptPrompt, buildFixPrompt, buildReviewPrompt, CONCEPT_PROVIDERS, checklist, conceptProviders, crossCheckSpelling, expectedText, initials, parseReview, requiredText,
} from "@/lib/concept-prompt";

const brief = (over: Partial<LogoBrief> = {}): LogoBrief => normalizeBrief({
  brandName: "Bloom & Co.",
  tagline: "",
  industry: "florist",
  audience: "young urban professionals",
  personality: ["fresh", "elegant"],
  logoType: "combination",
  typeReason: "Default",
  alternativeTypes: ["wordmark"],
  symbolIdeas: ["a tulip"],
  colors: ["sage green"],
  typography: "rounded sans",
  mustHave: [],
  avoid: ["roses"],
  summary: "A fresh florist logo.",
  missing: [],
  ...over,
});

describe("brief", () => {
  it("offers 9 static logo types with Combination mark as the default", () => {
    expect(LOGO_TYPES).toHaveLength(9);
    expect(DEFAULT_LOGO_TYPE).toBe("combination");
    expect(BRIEF_INSTRUCTIONS).toContain('use "combination" unless the notes clearly point elsewhere');
    expect(BRIEF_SCHEMA.required).toHaveLength(Object.keys(BRIEF_SCHEMA.properties).length);
  });

  it("never lets the model correct the brand name, and falls back to safe defaults", () => {
    expect(BRIEF_INSTRUCTIONS).toContain("character for character exactly as the client typed them");
    const b = normalizeBrief({ brandName: "  kwik-fix  ", logoType: "hologram", alternativeTypes: ["combination", "emblem", "emblem", "nope"] });
    expect(b.brandName).toBe("kwik-fix");
    expect(b.logoType).toBe("combination");
    expect(b.alternativeTypes).toEqual(["emblem"]);
    expect(normalizeBrief(null).personality).toEqual([]);
  });

  it("extracts only the chosen quality from a reference", () => {
    const typo = referenceInstructions("typography");
    expect(typo).toContain("ONLY its lettering");
    expect(typo).toContain("Do NOT mention its words, symbols, colours, layout");
    expect(referenceInstructions("layout")).toContain("Do NOT describe what the elements depict");
  });

  it("splits a pasted block into separate briefs", () => {
    expect(splitBriefs("Coffee shop called Ember\n\nA yoga studio, Still Water\n---\nLaw firm Hart & Lowe")).toEqual([
      "Coffee shop called Ember", "A yoga studio, Still Water", "Law firm Hart & Lowe",
    ]);
    expect(splitBriefs("1. Ember coffee\n2. Still Water yoga\n3) Hart law")).toEqual(["Ember coffee", "Still Water yoga", "Hart law"]);
  });
});

describe("concept prompts", () => {
  it("runs two concepts on OpenAI and two on Grok", () => {
    expect(CONCEPT_PROVIDERS.filter((p) => p === "openai")).toHaveLength(2);
    expect(CONCEPT_PROVIDERS.filter((p) => p === "grok")).toHaveLength(2);
    // Grok is off by default: all four from OpenAI.
    expect(conceptProviders(false)).toEqual(["openai", "openai", "openai", "openai"]);
    expect(conceptProviders(true)).toEqual(CONCEPT_PROVIDERS);
  });

  it("locks the exact name and asks for unique custom lettering, not a stock font", () => {
    const p = buildConceptPrompt(brief(), [], 0);
    expect(p).toContain('the brand name "Bloom & Co." exactly once');
    expect(p).toContain('1="B"; 2="l"; 3="o"; 4="o"; 5="m"; 6=" "; 7="&"');
    expect(p).toContain("not a recognisable stock font");
    expect(p).toContain("LOGO TYPE — COMBINATION MARK");
    expect(p).toContain("Avoid: roses.");
    expect(p).toContain("plain pure white");
  });

  it("applies references only for their role, as words", () => {
    const p = buildConceptPrompt(brief(), [{ role: "typography", description: "heavy condensed slab serif" }], 1);
    expect(p).toContain("TYPOGRAPHY ONLY: heavy condensed slab serif");
    expect(p).toContain("never reproduce a reference's symbol, wording or overall design");
    expect(p).toContain("concept 2 of 4");
  });

  it("uses initials for lettermarks and no text for symbol-only types", () => {
    expect(initials(brief({ brandName: "north star coffee", logoType: "lettermark" }))).toBe("NSC");
    expect(initials(brief({ brandName: "zephyr", logoType: "letterform" }))).toBe("z");
    expect(requiredText(brief({ logoType: "pictorial" }))).toEqual({ name: "", tagline: "" });
    expect(buildConceptPrompt(brief({ logoType: "abstract" }), [])).toContain("NO TEXT: the logo contains no letters");
    expect(expectedText(brief({ logoType: "wordmark", tagline: "Fresh daily" }))).toEqual(["Bloom & Co.", "Fresh daily"]);
  });

  it("fix prompts are local edits that keep the concept", () => {
    const p = buildFixPrompt(brief(), ["The 'o' is malformed"]);
    expect(p).toContain("fix ONLY the issues listed below");
    expect(p).toContain("1. The 'o' is malformed");
    expect(p).toContain('"Bloom & Co."');
  });
});

describe("review", () => {
  it("lists every check and only asks the reviewer for its own", () => {
    const checks = checklist(brief(), true);
    expect(checks.map((c) => c.id)).toEqual(["background", "margin", "clean", "colors", "mono", "small", "original", "spelling", "extra_text", "type", "brief", "references", "flat", "quality"]);
    expect(checklist(brief({ logoType: "pictorial" }), false).some((c) => c.id === "spelling")).toBe(false);
    const prompt = buildReviewPrompt(brief(), [], checks);
    expect(prompt).toContain('EXPECTED TEXT: "Bloom & Co."');
    expect(prompt).toContain("- spelling:");
    expect(prompt).not.toContain("- margin:");
  });

  it("treats a missing or malformed answer as a failure", () => {
    const checks = checklist(brief(), false);
    const { results } = parseReview({ checks: [{ id: "spelling", pass: true, issue: "" }, { id: "flat", pass: false, issue: "Remove the paper texture" }] }, checks);
    expect(results.find((r) => r.id === "spelling")?.pass).toBe(true);
    expect(results.find((r) => r.id === "flat")).toEqual({ id: "flat", pass: false, issue: "Remove the paper texture" });
    expect(results.find((r) => r.id === "quality")?.pass).toBe(false);
    expect(parseReview("garbage", checks).results.every((r) => !r.pass)).toBe(true);
  });

  it("fails spelling when the text the reviewer read doesn't match, even if it said pass", () => {
    const pass = [{ id: "spelling" as const, pass: true, issue: "" }];
    expect(crossCheckSpelling(pass, "Bloom & Co.", ["Bloom & Co."])[0]!.pass).toBe(true);
    expect(crossCheckSpelling(pass, "Bloom &\nCo.", ["Bloom & Co."])[0]!.pass).toBe(true);
    const bad = crossCheckSpelling(pass, "Blom & Co.", ["Bloom & Co."])[0]!;
    expect(bad.pass).toBe(false);
    expect(bad.issue).toContain('"Blom & Co."');
  });
});

describe("empty form fields", () => {
  it("never treats a placeholder like 'Unspecified' as a slogan, name or colour", async () => {
    const { isPlaceholder } = await import("@/lib/brief");
    const b = normalizeBrief({ brandName: "AK Cards", tagline: "Unspecified", colors: ["N/A", "forest green", "—"], mustHave: ["None"], typography: "not specified", summary: "A vintage sports card logo." });
    expect(b.tagline).toBe("");
    expect(b.colors).toEqual(["forest green"]);
    expect(b.mustHave).toEqual([]);
    expect(b.typography).toBe("");
    expect(b.brandName).toBe("AK Cards");
    expect(normalizeBrief({ brandName: "NA" }).brandName).toBe("NA");
    expect(normalizeBrief({ brandName: "Unspecified" }).brandName).toBe("");
    for (const p of ["Unspecified", "unspecified.", "(Unspecified)", "None", "n/a", "NA", "-", "—", "TBD", "No slogan", "\"None\""]) expect(isPlaceholder(p)).toBe(true);
    for (const real of ["Unspecified Studios", "None Like It", "Nate", "No Limits"]) expect(isPlaceholder(real)).toBe(false);
    // Nothing to draw: the concept prompt gets no tagline line.
    expect(buildConceptPrompt(normalizeBrief({ brandName: "AK Cards", tagline: "Unspecified", logoType: "combination", summary: "x" }), [])).not.toContain("TAGLINE");
  });

  it("tells both the brief model and the screenshot reader that placeholders mean empty", async () => {
    const { EXTRACT_INSTRUCTIONS } = await import("@/lib/brief-extract");
    expect(BRIEF_INSTRUCTIONS).toContain("never use the placeholder word itself as a slogan");
    expect(EXTRACT_INSTRUCTIONS).toContain("never transcribe the placeholder as its value");
  });
});

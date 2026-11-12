import { describe, expect, it } from "vitest";
import { cleanPastedBrief } from "@/lib/clean-paste";

const PAGE = `Skip to content
Home
Services
Portfolio
About us
Contact
Login
Home › Design contests › Logo
Logo design for Fernwood Bakery
Posted on 3 May 2026
We're Fernwood Bakery, a family-run sourdough bakery in Leeds opening our second shop.
We'd like a warm, hand-crafted logo with the name "Fernwood Bakery" — maybe a fern or wheat stalk.
Colours: forest green and cream. Please avoid anything that looks corporate.
Read more →
[See our menu](https://fernwood.example/menu) for the vibe.
https://fernwood.example
Share on Facebook
Facebook
Instagram
Twitter
LinkedIn
Subscribe to our newsletter
Enter your email
We use cookies to improve your experience. Accept all
Privacy Policy
Terms of Service
© 2026 Designboard Ltd. All rights reserved.`;

describe("pasted brief cleanup", () => {
  it("keeps the brief and drops the page around it", () => {
    const { text, removed } = cleanPastedBrief(PAGE);
    expect(text).toContain("Logo design for Fernwood Bakery");
    expect(text).toContain('the name "Fernwood Bakery"');
    expect(text).toContain("Colours: forest green and cream.");
    expect(text).toContain("See our menu for the vibe.");
    for (const junk of ["Skip to content", "Portfolio", "Login", "Design contests", "Posted on", "Read more", "https://", "Facebook", "Instagram", "newsletter", "cookies", "Privacy Policy", "©"]) {
      expect(text).not.toContain(junk);
    }
    expect(removed).toBeGreaterThanOrEqual(20);
  });

  it("leaves a typed brief alone", () => {
    const typed = "coffee shop called Ember\ncosy but modern, maybe a flame\nwarm colours, no cups";
    expect(cleanPastedBrief(typed)).toEqual({ text: typed, removed: 0 });
  });

  it("keeps short brief lines that aren't part of a menu, and removes repeats", () => {
    const { text } = cleanPastedBrief("Name: Halo\n\nMinimal\n\nName: Halo\nA calm wellness app for night-shift nurses.");
    expect(text).toBe("Name: Halo\n\nMinimal\n\nA calm wellness app for night-shift nurses.");
  });
});

describe("design-contest boilerplate", () => {
  it("drops deliverables, final files, formats, outline rules and platform policies, keeping the brief", () => {
    const pasted = `Name to incorporate in the logo
AK Cards
Other notes
We're big outdoor people (hiking, camping, hunting, etc) and we'd love to incorporate that if possible.
Generative AI use is not allowed in this category.
Learn more
Contest deliverables:
1 x Logo
Download template
Final files:
Layered vectors: AI, EPS
Screen quality: PNG, JPG, PDF
AI
EPS
PNG, JPG, PDF
Text in logos should be converted to outlines.`;
    const { text } = cleanPastedBrief(pasted);
    expect(text).toContain("AK Cards");
    expect(text).toContain("We're big outdoor people");
    for (const junk of ["Generative AI", "Learn more", "Contest deliverables", "1 x Logo", "Download template", "Final files", "Layered vectors", "Screen quality", "EPS", "PDF", "outlines"]) {
      expect(text).not.toContain(junk);
    }
  });
});

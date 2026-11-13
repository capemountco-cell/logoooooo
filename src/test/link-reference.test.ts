import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanLink, findLinks, isPublicUrl, linkContext, parsePage, roleNear } from "@/lib/link-reference";
import { readLink } from "@/lib/link-reference.server";

describe("findLinks", () => {
  it("finds the link in the user's brief and reads its role from the words before it", () => {
    const notes = "CAMU — Mac app updater.\nStyle reference: https://camu-app.lovable.app/\nKeep it minimal.";
    expect(findLinks(notes)).toEqual([{ url: "https://camu-app.lovable.app/", role: "style" }]);
  });

  it("picks the role word closest to the link, strips punctuation and de-duplicates", () => {
    const notes = "Logo style, but colours from www.example.com/palette.\nFont like https://fonts.example.org/x, and https://fonts.example.org/x again";
    expect(findLinks(notes)).toEqual([
      { url: "https://www.example.com/palette", role: "colour" },
      { url: "https://fonts.example.org/x", role: "typography" },
    ]);
  });

  it("treats generic words as style and caps the number of links", () => {
    expect(roleNear("colour reference: ")).toBe("colour");
    expect(roleNear("inspiration: ")).toBe("style");
    expect(roleNear("", " (the lettering)")).toBe("typography");
    expect(findLinks("a.com/1 https://a.com/2 https://a.com/3 https://a.com/4 https://a.com/5")).toHaveLength(3);
  });

  it("rejects things that aren't links", () => {
    expect(cleanLink("not a link")).toBeNull();
    expect(cleanLink("javascript:alert(1)")).toBeNull();
    expect(cleanLink("www.site.io.")).toBe("https://www.site.io/");
  });
});

describe("isPublicUrl", () => {
  it("allows public web hosts only", () => {
    expect(isPublicUrl("https://camu-app.lovable.app/")).toBe(true);
    expect(isPublicUrl("http://93.184.216.34/")).toBe(true);
    for (const bad of [
      "http://localhost:3000/", "http://127.0.0.1/", "http://10.0.0.5/", "http://192.168.1.1/", "http://172.20.1.1/",
      "http://169.254.169.254/latest/meta-data", "http://[::1]/", "http://[fd00::1]/", "http://[::ffff:127.0.0.1]/",
      "http://2130706433/", "http://0x7f000001/", "http://printer.local/", "http://db.internal/", "ftp://example.com/",
      "https://user:pass@example.com/", "https://example.com:8443/", "file:///etc/passwd",
    ]) expect(isPublicUrl(bad), bad).toBe(false);
  });
});

describe("parsePage", () => {
  const html = `<!doctype html><html><head><title>Camu: keep every Mac app up to date</title>
    <meta name="description" content="Updates all your apps in one click &amp; free.">
    <link rel="preload" as="image" href="/assets/camu-icon.png"><link rel="icon" href="/favicon.png">
    <script>var junk = "ignore me"</script><style>.a{}</style></head>
    <body><nav>Home Pricing</nav><h1>Every app, up to date</h1><img src="/pixel.gif" width="1" height="1"><img src="https://cdn.example.com/shot.jpg"><footer>© 2026</footer></body></html>`;

  it("reads the title, description, visible text and images in priority order", () => {
    const page = parsePage(html, "https://camu-app.lovable.app/");
    expect(page.title).toBe("Camu: keep every Mac app up to date");
    expect(page.description).toBe("Updates all your apps in one click & free.");
    expect(page.text).toContain("Every app, up to date");
    expect(page.text).not.toMatch(/ignore me|Pricing|©/);
    expect(page.images).toEqual(["https://camu-app.lovable.app/assets/camu-icon.png", "https://cdn.example.com/shot.jpg", "https://camu-app.lovable.app/favicon.png"]);
  });

  it("puts the share image first and writes one line of context", () => {
    const page = parsePage(`<meta property="og:image" content="/og.png"><img src="/a.png">`, "https://x.com/p/");
    expect(page.images[0]).toBe("https://x.com/og.png");
    expect(linkContext("https://www.camu.app/", "style", { title: "Camu", description: "Mac updater", text: "" })).toBe("Linked style reference (camu.app): Camu — Mac updater");
  });
});

describe("readLink", () => {
  afterEach(() => vi.unstubAllGlobals());
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  it("fetches the page and its images, never following a redirect into a private network", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      seen.push(url);
      if (url === "https://site.example/") return new Response(`<title>Site</title><img src="/a.png"><img src="https://evil.example/r.png">`, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      if (url === "https://site.example/a.png") return new Response(png, { headers: { "Content-Type": "image/png" } });
      if (url === "https://evil.example/r.png") return new Response(null, { status: 302, headers: { Location: "http://169.254.169.254/x.png" } });
      return new Response("nope", { status: 404 });
    }));
    const page = await readLink("https://site.example/");
    expect(page.title).toBe("Site");
    expect(page.images).toHaveLength(1);
    expect(page.images[0]).toMatch(/^data:image\/png;base64,/);
    expect(seen).not.toContain("http://169.254.169.254/x.png");
  });

  it("refuses private addresses outright", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await expect(readLink("http://127.0.0.1/admin")).rejects.toThrow(/public web page/);
    expect(fetch).not.toHaveBeenCalled();
  });
});

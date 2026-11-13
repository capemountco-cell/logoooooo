// Links in a brief, opened as references (pure, DOM-free, tested).
// A URL in the notes ("style reference: https://…") becomes a reference: the server fetches the
// public page, its images become one contact-sheet reference for the role named next to the link,
// and the page's title/description go to the brief model as context.
import type { ReferenceRole } from "@/lib/brief";

export const MAX_LINKS = 3;

export type LinkRef = { url: string; role: ReferenceRole };

const URL_RE = /\bhttps?:\/\/[^\s<>"'`)\]]+|\bwww\.[^\s<>"'`)\]]+/gi;

/** Words near a link that say what it is a reference for. Checked in order. */
const ROLE_WORDS: [ReferenceRole, RegExp][] = [
  ["typography", /\b(typograph\w*|fonts?|typefaces?|lettering|letterforms?|type style)\b/i],
  ["colour", /\b(colou?rs?|palettes?|hues?|tones?)\b/i],
  ["layout", /\b(layouts?|composition|arrangement|lockup)\b/i],
  ["mood", /\b(mood|vibe|feel(ing)?|atmosphere|energy)\b/i],
  ["concept", /\b(concepts?|ideas?|symbols?|icons?|mark|metaphor)\b/i],
  ["style", /\b(style|styling|aesthetic|look and feel)\b/i],
];
// Generic words ("reference", "inspiration", "design") name no role, so a bare link means style.

/** The role named just before a link on its line (else after it); style when nothing is said. */
export function roleNear(before: string, after = ""): ReferenceRole {
  for (const text of [before.slice(-80), after.slice(0, 40)]) {
    let best: { role: ReferenceRole; at: number } | null = null;
    for (const [role, re] of ROLE_WORDS) {
      const all = [...text.matchAll(new RegExp(re.source, "gi"))];
      const last = all.at(-1);
      // The word closest to the link wins ("logo style, colours: <url>" → colour).
      if (last?.index !== undefined && (!best || last.index > best.at)) best = { role, at: last.index };
    }
    if (best) return best.role;
  }
  return "style";
}

/** Normalises a pasted link: adds https to www., strips trailing punctuation. Null if unusable. */
export function cleanLink(raw: string): string | null {
  let s = raw.trim().replace(/[.,;:!?…]+$/, "");
  if (/^www\./i.test(s)) s = `https://${s}`;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!u.hostname.includes(".")) return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

/** Links in the notes with the role each is for, de-duplicated, at most MAX_LINKS. */
export function findLinks(notes: string): LinkRef[] {
  const out: LinkRef[] = [];
  for (const line of notes.split(/\r?\n/)) {
    for (const m of line.matchAll(URL_RE)) {
      const url = cleanLink(m[0]);
      if (!url || out.some((l) => l.url === url)) continue;
      const at = m.index ?? 0;
      out.push({ url, role: roleNear(line.slice(0, at), line.slice(at + m[0].length)) });
      if (out.length >= MAX_LINKS) return out;
    }
  }
  return out;
}

// ---------- safety: only public web hosts ----------

function privateV4(h: string) {
  const p = h.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = p as [number, number, number, number];
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19));
}

/**
 * Whether a URL may be fetched by the server: http(s) on the default port, a public DNS name or
 * public IP — never localhost, private/link-local ranges, internal names or embedded credentials.
 */
export function isPublicUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  if (u.username || u.password) return false;
  if (u.port && u.port !== "80" && u.port !== "443") return false;
  const h = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!h || h === "localhost" || /\.(localhost|local|internal|intranet|lan|home|corp|arpa)$/.test(h)) return false;
  if (h.startsWith("[")) {
    // IPv6 literals: only clearly public global addresses (2000::/3), never mapped/local ones.
    const v6 = h.slice(1, -1);
    return /^[23][0-9a-f]{0,3}:/i.test(v6) && !/^2001:db8:/i.test(v6) && !v6.includes(".");
  }
  if (/^[\d.]+$/.test(h)) return !privateV4(h);
  if (/^0x|^\d+$/i.test(h)) return false; // integer/hex IP forms
  return h.includes(".");
}

// ---------- reading a page ----------

export type PageInfo = { title: string; description: string; text: string; images: string[] };

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));

function attr(tag: string, name: string) {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? decode(m[1] ?? m[2] ?? m[3] ?? "").trim() : "";
}

function meta(html: string, keys: string[]) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = (attr(tag, "property") || attr(tag, "name")).toLowerCase();
    if (keys.includes(key)) {
      const v = attr(tag, "content");
      if (v) return v;
    }
  }
  return "";
}

/** Images worth looking at, best first: share image, preloaded hero images, page images, icons. */
function pageImages(html: string, base: URL) {
  const found: string[] = [];
  const add = (src: string) => {
    if (!src || src.startsWith("data:")) return;
    try {
      const u = new URL(src, base);
      if ((u.protocol === "https:" || u.protocol === "http:") && !found.includes(u.toString())) found.push(u.toString());
    } catch {
      /* ignore */
    }
  };
  add(meta(html, ["og:image", "og:image:url", "og:image:secure_url"]));
  add(meta(html, ["twitter:image", "twitter:image:src"]));
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) if (/rel\s*=\s*["']?preload/i.test(tag) && /as\s*=\s*["']?image/i.test(tag)) add(attr(tag, "href"));
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    const src = attr(tag, "src") || attr(tag, "data-src") || attr(tag, "srcset").split(/\s+/)[0] || "";
    // Tracking pixels and spacers say nothing about the look.
    const w = Number(attr(tag, "width")), h = Number(attr(tag, "height"));
    if ((w && w < 32) || (h && h < 32) || /pixel|spacer|tracking|badge|analytics/i.test(src)) continue;
    add(src);
  }
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) if (/rel\s*=\s*["']?(apple-touch-icon|icon)/i.test(tag)) add(attr(tag, "href"));
  return found;
}

/** Title, description, visible text (bounded) and candidate images from a page's HTML. */
export function parsePage(html: string, baseUrl: string): PageInfo {
  const base = new URL(baseUrl);
  const title = decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").replace(/\s+/g, " ").trim() || meta(html, ["og:title", "twitter:title"]);
  const description = meta(html, ["description", "og:description", "twitter:description"]).replace(/\s+/g, " ");
  const text = decode(
    html
      .replace(/<(script|style|noscript|svg|template|head)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<(nav|footer)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1200);
  return { title: title.slice(0, 200), description: description.slice(0, 400), text, images: pageImages(html, base).slice(0, 12) };
}

/** One line of context for the brief model about a linked page. */
export function linkContext(url: string, role: ReferenceRole, page: Pick<PageInfo, "title" | "description" | "text">) {
  const host = new URL(url).hostname.replace(/^www\./, "");
  const about = [page.title, page.description].filter(Boolean).join(" — ") || page.text.slice(0, 300);
  return `Linked ${role} reference (${host}): ${about || "no readable text"}`.slice(0, 600);
}

export const LINK_CONTEXT_HEADER =
  "Pages linked in the notes (opened by LOGOO; each is a reference for the role named, and its images are read for that role only — do not copy its brand name unless the notes say it is the brand's own site):";

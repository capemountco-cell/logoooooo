// Opens a public page linked in a brief (server only). Every hop, redirects included, must pass
// isPublicUrl, so a link can never reach localhost or a private network; sizes and time are capped.
import { isPublicUrl, parsePage, type PageInfo } from "@/lib/link-reference";
import { bytesToDataUrl } from "@/lib/openai-text.server";

const UA = "Mozilla/5.0 (compatible; LOGOO reference reader)";
const MAX_HTML = 2_000_000;
const MAX_IMAGE = 4_000_000;
const MAX_IMAGES = 4;
const TIMEOUT = 10_000;

export class LinkError extends Error {}

async function readCapped(res: Response, max: number) {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(await res.arrayBuffer()).slice(0, max);
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      throw new LinkError("too large");
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.byteLength; }
  return out;
}

/** Fetches a public URL, following up to 4 redirects by hand and re-checking each one. */
export async function fetchPublic(url: string, accept: string, signal?: AbortSignal): Promise<Response> {
  const timeout = AbortSignal.timeout(TIMEOUT);
  const both = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let current = url;
  for (let hop = 0; hop <= 4; hop++) {
    if (!isPublicUrl(current)) throw new LinkError("That link isn't a public web page.");
    const res = await fetch(current, { headers: { "User-Agent": UA, Accept: accept }, redirect: "manual", signal: both });
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get("Location");
      if (!next) throw new LinkError("The page redirected nowhere.");
      current = new URL(next, current).toString();
      continue;
    }
    return res;
  }
  throw new LinkError("Too many redirects.");
}

async function fetchImage(url: string, signal?: AbortSignal) {
  const res = await fetchPublic(url, "image/avif,image/webp,image/png,image/jpeg,image/svg+xml,*/*;q=0.5", signal);
  const type = (res.headers.get("Content-Type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (!res.ok || !/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(type)) return "";
  return bytesToDataUrl(await readCapped(res, MAX_IMAGE), type);
}

export type LinkPage = Omit<PageInfo, "images"> & { url: string; images: string[] };

/** The page's text and up to four of its images (data URLs), best first. */
export async function readLink(url: string, signal?: AbortSignal): Promise<LinkPage> {
  const res = await fetchPublic(url, "text/html,application/xhtml+xml,image/*;q=0.8", signal);
  if (!res.ok) throw new LinkError(`The page answered ${res.status}.`);
  const type = (res.headers.get("Content-Type") ?? "").split(";")[0]!.trim().toLowerCase();
  // A direct image link is used as it is.
  if (type.startsWith("image/")) {
    if (!/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(type)) throw new LinkError("That image type can't be read.");
    return { url, title: "", description: "", text: "", images: [bytesToDataUrl(await readCapped(res, MAX_IMAGE), type)] };
  }
  if (!/html|xml|text\/plain/.test(type)) throw new LinkError("That link isn't a web page or image.");
  const html = new TextDecoder().decode(await readCapped(res, MAX_HTML));
  const page = parsePage(html, res.url || url);
  const images: string[] = [];
  // Fetched a few at a time, in page order, until four have loaded.
  for (let i = 0; i < page.images.length && images.length < MAX_IMAGES; i += 4) {
    const batch = await Promise.all(page.images.slice(i, i + 4).map((u) => fetchImage(u, signal).catch(() => "")));
    images.push(...batch.filter(Boolean));
  }
  return { ...page, url, images: images.slice(0, MAX_IMAGES) };
}

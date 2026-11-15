// Browser side of logo generation: reference prep, brief cleanup, drawing, checking.
// Every job passes its own inputs and signal in; nothing here is shared between jobs.
import type { LogoBrief, ReferenceNote, ReferenceRole } from "@/lib/brief";
import { normalizeBrief } from "@/lib/brief";
import { autoChecks, despeckle, measureConcept } from "@/lib/concept-checks";
import { checklist, type CheckDef, type CheckResult } from "@/lib/concept-prompt";
import type { ConceptDeps } from "@/lib/concept-pipeline";
import { coverageSignature } from "@/lib/logo-fidelity";
import { adviseColor } from "@/lib/color-trace";
import { coverageFromRgba } from "@/lib/vectorize";
import { logoFile } from "@/lib/logo-files";
import { streamImage } from "@/lib/stream-image";
import type { AutoReference, Candidate, SearchProvider } from "@/lib/reference-search";
import { TILE, tileRects } from "@/lib/brief-extract";
import { linkContext } from "@/lib/link-reference";
import { fallbackPlans, normalizePlan, readPlans, type ConceptPlan } from "@/lib/concept-plan";
import { aggregateSwatches, buildPalette, logoSwatches, type PaletteColor } from "@/lib/palette";

/** Pixels of an image (data URL or file), converted to sRGB by the canvas, long side ≤ maxSide. */
export async function imagePixels(src: string | Blob, maxSide = 1024) {
  const bitmap = await createImageBitmap(typeof src === "string" ? await (await fetch(src)).blob() : src);
  try {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale)), height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not read the image.");
    // Transparency reads as black to the AI, so references are flattened onto white.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    return { canvas, width, height, rgba: ctx.getImageData(0, 0, width, height).data };
  } finally {
    bitmap.close();
  }
}

export type PreparedRef = {
  id: string;
  role: ReferenceRole;
  /** Flattened, ≤1024px PNG sent to the brief model. */
  file: File;
  preview: string;
  /** Shape fingerprint, so a concept that copies it is caught. */
  signature: Float32Array;
  /** Measured palette (hex), used directly for colour references. */
  palette: string[];
};

export async function prepareRef(file: File, role: ReferenceRole): Promise<PreparedRef> {
  const { canvas, width, height, rgba } = await imagePixels(file, 1024);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  if (!blob) throw new Error("Could not prepare that reference.");
  return {
    id: crypto.randomUUID(),
    role,
    file: new File([blob], "reference.png", { type: "image/png" }),
    preview: URL.createObjectURL(blob),
    signature: coverageSignature(coverageFromRgba(rgba, width, height), width, height),
    palette: adviseColor(rgba, width, height).palette.slice(0, 5),
  };
}

async function failure(res: Response, fallback: string) {
  const text = (await res.text().catch(() => "")).trim();
  return new Error(`${res.status} ${text || fallback}`.trim());
}

/** Messy notes + references → a clean brief and reference notes. */
export async function cleanBrief(notes: string, refs: PreparedRef[], signal: AbortSignal): Promise<{ brief: LogoBrief; references: ReferenceNote[] }> {
  const form = new FormData();
  form.append("notes", notes);
  refs.forEach((r, i) => {
    form.append(`role${i}`, r.role);
    form.append(`ref${i}`, r.file);
    if (r.role === "colour" && r.palette.length) form.append(`palette${i}`, r.palette.join(", "));
  });
  const res = await fetch("/api/brief", { method: "POST", body: form, signal });
  if (!res.ok) throw await failure(res, "Couldn't read your brief.");
  const json = (await res.json()) as { brief: unknown; references: ReferenceNote[] };
  return { brief: normalizeBrief(json.brief), references: json.references ?? [] };
}

export type JobInput = {
  brief: LogoBrief;
  references: ReferenceNote[];
  signatures: Float32Array[];
  /** One planned idea per concept index. */
  plans?: ConceptPlan[];
  /** Reference pictures the image model may look at, each for its role only (setting "Let the image AI see references"). */
  pictures?: { role: ReferenceRole; image: string }[];
};

/** A reference picture as a ≤768 px PNG for the image model (flattened on white, sRGB). */
async function pictureFile(src: string, i: number) {
  const { canvas } = await imagePixels(src, 768);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  if (!blob) throw new Error("Could not prepare a reference picture.");
  return new File([blob], `reference-${i + 1}.png`, { type: "image/png" });
}

/**
 * Plans a round: one genuinely different idea per concept (concept-plan.ts). Never blocks a
 * round — if planning fails, distinct fallback strategies from the brief are used.
 */
export async function planConcepts(brief: LogoBrief, references: ReferenceNote[], count: number, tried: string[], signal?: AbortSignal): Promise<ConceptPlan[]> {
  try {
    const res = await fetch("/api/concept-plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brief, references, count, tried }), signal: signal ?? null });
    if (!res.ok) throw new Error(String(res.status));
    const { plans } = (await res.json()) as { plans: unknown[] };
    const ok = (Array.isArray(plans) ? plans : []).map(normalizePlan).filter((p): p is ConceptPlan => Boolean(p));
    return ok.length >= count ? ok.slice(0, count) : readPlans({ concepts: ok }, brief, count);
  } catch (e) {
    if (signal?.aborted) throw e;
    return fallbackPlans(brief, count);
  }
}

/** The draw/check dependencies for one job's concepts. */
export function conceptDeps(input: JobInput, checks: CheckDef[] = checklist(input.brief, input.references.length > 0)): ConceptDeps {
  const briefJson = JSON.stringify(input.brief);
  const refsJson = JSON.stringify(input.references);
  // Prepared once per job and shared by every concept; a picture that can't be read is left out.
  let pictures: Promise<{ role: ReferenceRole; file: File }[]> | null = null;
  const preparePictures = () =>
    (pictures ??= Promise.all((input.pictures ?? []).slice(0, 4).map((p, i) => pictureFile(p.image, i).then((file) => ({ role: p.role, file })).catch(() => null))).then((all) =>
      all.filter((x): x is { role: ReferenceRole; file: File } => Boolean(x)),
    ));
  return {
    draw: async (req, onFrame, signal) => {
      const form = new FormData();
      form.append("brief", briefJson);
      form.append("references", refsJson);
      form.append("index", String(req.index));
      form.append("provider", req.provider);
      const plan = input.plans?.[req.index];
      if (plan) form.append("plan", JSON.stringify(plan));
      if (req.draft && req.recreate !== undefined) {
        form.append("image", logoFile(req.draft, "concept.png", "image/png"));
        form.append("recreate", req.recreate.slice(0, 300));
      } else if (req.draft && req.issues) {
        form.append("image", logoFile(req.draft, "draft.png", "image/png"));
        form.append("issues", JSON.stringify(req.issues));
      } else if (req.provider === "openai") {
        (await preparePictures()).forEach((p, i) => {
          form.append(`refImage${i}`, p.file);
          form.append(`refRole${i}`, p.role);
        });
      }
      let final = "";
      await streamImage("/api/concept", form, (src, isFinal) => {
        onFrame(src);
        if (isFinal) final = src;
      }, signal);
      if (!final) throw new Error("No logo came back.");
      return final;
    },
    auto: async (src) => {
      // Compression noise is cleaned first (as it is before tracing), so it never fails a concept.
      const { width, height, rgba } = await imagePixels(src, 1024);
      return autoChecks(measureConcept(despeckle(rgba, width, height).rgba, width, height), input.brief, checks, input.signatures);
    },
    review: async (src, signal): Promise<CheckResult[]> => {
      const form = new FormData();
      form.append("image", logoFile(src, "concept.png", "image/png"));
      form.append("brief", briefJson);
      form.append("references", refsJson);
      const res = await fetch("/api/review", { method: "POST", body: form, signal });
      if (!res.ok) throw await failure(res, "The quality check couldn't run.");
      return ((await res.json()) as { results: CheckResult[] }).results;
    },
  };
}

// ---------- references in use (uploaded or found automatically) ----------

/** A reference a job uses: its role, role-limited description, picture and shape fingerprint. */
export type RefItem = {
  id: string;
  role: ReferenceRole;
  description: string;
  /** Data URL or object URL of the picture. */
  image: string;
  signature: Float32Array;
  /** Found by the AI (vs uploaded by the user). */
  auto: boolean;
  candidate?: Candidate | undefined;
  /** The web page this reference was taken from, when it came from a link. */
  link?: string | undefined;
  /** Picked from the designer's own saved references ("My references"). */
  fromLibrary?: boolean | undefined;
};

async function signatureOf(image: string) {
  const { width, height, rgba } = await imagePixels(image, 512);
  return coverageSignature(coverageFromRgba(rgba, width, height), width, height);
}

export type FoundRefs = { provider: SearchProvider; refs: RefItem[]; candidates: Candidate[]; samples: string[] };

/** Asks the server to search, pick and describe references for the brief. */
export async function findAutoRefs(brief: LogoBrief, opts: { exclude?: string[]; roles?: ReferenceRole[] }, signal: AbortSignal): Promise<FoundRefs> {
  // The designer's saved references go along (small), so the picker can choose their taste first.
  const library = (await import("@/lib/library").then((m) => m.loadLibrary().then((l) => l.slice(0, m.LIBRARY_PER_SEARCH))).catch(() => []));
  const res = await fetch("/api/references", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ brief, ...opts, library }),
    signal,
  });
  if (!res.ok) throw await failure(res, "Couldn't find references.");
  const json = (await res.json()) as { provider: SearchProvider; references: AutoReference[]; candidates: Candidate[]; samples?: string[] };
  const refs = await Promise.all(
    json.references.map(async (r): Promise<RefItem> => ({
      id: crypto.randomUUID(), role: r.role, description: r.description, image: r.image, signature: await signatureOf(r.image), auto: true, candidate: r.candidate, fromLibrary: !r.candidate,
    })),
  );
  return { provider: json.provider, refs, candidates: json.candidates, samples: json.samples ?? [] };
}

/** Describes one reference for a role: an uploaded file, or a search candidate's thumbnail. */
export async function describeRef(role: ReferenceRole, src: { file?: File; candidate?: Candidate }, signal?: AbortSignal): Promise<RefItem> {
  const form = new FormData();
  form.append("role", role);
  if (src.file) form.append("image", src.file);
  else if (src.candidate) form.append("url", src.candidate.thumb);
  const res = await fetch("/api/reference-note", { method: "POST", body: form, signal: signal ?? null });
  if (!res.ok) throw await failure(res, "Couldn't read that reference.");
  const { description, image } = (await res.json()) as { description: string; image: string };
  return { id: crypto.randomUUID(), role, description, image, signature: await signatureOf(image), auto: Boolean(src.candidate), candidate: src.candidate };
}

// ---------- references from links ----------

const loadImg = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("bad image"));
    img.src = src;
  });

/**
 * A page's images as one reference picture: a single image as it is, or up to four on a 2 × 2
 * white contact sheet, so the vision model reads the site's overall look. Tiny images are skipped.
 */
export async function contactSheet(images: string[]): Promise<File | null> {
  const loaded = (await Promise.all(images.map((src) => loadImg(src).catch(() => null)))).filter(
    (img): img is HTMLImageElement => Boolean(img) && Math.min(img!.naturalWidth, img!.naturalHeight) >= 48,
  ).slice(0, 4);
  if (!loaded.length) return null;
  const size = 1024, cols = loaded.length === 1 ? 1 : 2, rows = loaded.length <= 2 ? 1 : 2;
  const cw = size / cols, ch = loaded.length === 1 ? size : size / 2;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = ch * rows;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  loaded.forEach((img, i) => {
    const pad = loaded.length === 1 ? 0 : 12;
    const s = Math.min((cw - pad * 2) / img.naturalWidth, (ch - pad * 2) / img.naturalHeight);
    const w = img.naturalWidth * s, h = img.naturalHeight * s;
    ctx.drawImage(img, (i % cols) * cw + (cw - w) / 2, Math.floor(i / cols) * ch + (ch - h) / 2, w, h);
  });
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  return blob ? new File([blob], "link-reference.png", { type: "image/png" }) : null;
}

export type LinkResult = { url: string; role: ReferenceRole; context: string; ref: PreparedRef | null };

/** Opens a link from the brief (on the server) and turns it into a reference + a line of context. */
export async function openLink(url: string, role: ReferenceRole, signal?: AbortSignal): Promise<LinkResult> {
  const form = new FormData();
  form.append("url", url);
  const res = await fetch("/api/link-reference", { method: "POST", body: form, signal: signal ?? null });
  if (!res.ok) throw await failure(res, "Couldn't open that page.");
  const page = (await res.json()) as { url: string; title: string; description: string; text: string; images: string[] };
  const sheet = await contactSheet(page.images ?? []);
  return { url, role, context: linkContext(url, role, page), ref: sheet ? await prepareRef(sheet, role) : null };
}

// ---------- briefs from uploads ----------

/** Cuts a screenshot into readable JPEG sections (top to bottom), read through the canvas (sRGB). */
export async function briefSections(file: Blob): Promise<File[]> {
  const bitmap = await createImageBitmap(file);
  try {
    // Narrow phone captures are scaled up to the section width so their small text stays legible.
    const scale = TILE.width / bitmap.width;
    const width = TILE.width, height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not read the screenshot.");
    const out: File[] = [];
    for (const [i, r] of tileRects(height).entries()) {
      canvas.width = width;
      canvas.height = Math.min(r.height, height - r.y);
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, r.y / scale, bitmap.width, canvas.height / scale, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.9));
      if (!blob) throw new Error("Could not prepare the screenshot.");
      out.push(new File([blob], `brief-${i + 1}.jpg`, { type: "image/jpeg" }));
    }
    return out;
  } finally {
    bitmap.close();
  }
}

/**
 * Turns an uploaded brief into text for the composer: text files are read as they are, PDFs go
 * to the model whole, and screenshots go as ordered sections. Returns how many sections were read.
 */
export async function extractBrief(file: File, signal?: AbortSignal): Promise<{ text: string; sections: number }> {
  if (file.type.startsWith("text/") || /\.(txt|md)$/i.test(file.name)) {
    return { text: (await file.text()).slice(0, 60_000), sections: 1 };
  }
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (!isPdf && !file.type.startsWith("image/")) throw new Error("Use a screenshot (PNG, JPG, WebP), a PDF or a text file.");
  const parts = isPdf ? [new File([file], file.name || "brief.pdf", { type: "application/pdf" })] : await briefSections(file);
  const form = new FormData();
  for (const p of parts) form.append("file", p);
  const res = await fetch("/api/brief-extract", { method: "POST", body: form, signal: signal ?? null });
  if (!res.ok) throw await failure(res, "Couldn't read that brief.");
  const { text } = (await res.json()) as { text: string };
  return { text, sections: parts.length };
}

/** A generated concept with its compression noise and stray specks removed (PNG data URL), for tracing. */
export async function cleanConcept(src: string): Promise<string> {
  const { canvas, width, height, rgba } = await imagePixels(src, 2048);
  const { rgba: clean, removed } = despeckle(rgba, width, height);
  if (!removed) return src;
  const ctx = canvas.getContext("2d");
  if (!ctx) return src;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(clean), width, height), 0, 0);
  return canvas.toDataURL("image/png");
}

/**
 * A palette for a brief that names no colours: the colours measured from real logos in the same
 * space (Brave reference samples), shaped by colour theory; colour-psychology defaults if none load.
 */
export async function measurePalette(samples: string[], brief: LogoBrief): Promise<PaletteColor[]> {
  const perLogo = (
    await Promise.all(samples.map(async (src) => {
      try {
        const { width, height, rgba } = await imagePixels(src, 160);
        return logoSwatches(rgba, width, height);
      } catch {
        return [];
      }
    }))
  ).filter((s) => s.length);
  return buildPalette(aggregateSwatches(perLogo), brief);
}

// Browser side of logo generation: reference prep, brief cleanup, drawing, checking.
// Every job passes its own inputs and signal in; nothing here is shared between jobs.
import type { LogoBrief, ReferenceNote, ReferenceRole } from "@/lib/brief";
import { normalizeBrief } from "@/lib/brief";
import { autoChecks, measureConcept } from "@/lib/concept-checks";
import { checklist, type CheckDef, type CheckResult } from "@/lib/concept-prompt";
import type { ConceptDeps } from "@/lib/concept-pipeline";
import { coverageSignature } from "@/lib/logo-fidelity";
import { adviseColor } from "@/lib/color-trace";
import { coverageFromRgba } from "@/lib/vectorize";
import { logoFile } from "@/lib/logo-files";
import { streamImage } from "@/lib/stream-image";

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

export type JobInput = { brief: LogoBrief; references: ReferenceNote[]; signatures: Float32Array[] };

/** The draw/check dependencies for one job's concepts. */
export function conceptDeps(input: JobInput, checks: CheckDef[] = checklist(input.brief, input.references.length > 0)): ConceptDeps {
  const briefJson = JSON.stringify(input.brief);
  const refsJson = JSON.stringify(input.references);
  return {
    draw: async (req, onFrame, signal) => {
      const form = new FormData();
      form.append("brief", briefJson);
      form.append("references", refsJson);
      form.append("index", String(req.index));
      form.append("provider", req.provider);
      if (req.draft && req.issues) {
        form.append("image", logoFile(req.draft, "draft.png", "image/png"));
        form.append("issues", JSON.stringify(req.issues));
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
      const { width, height, rgba } = await imagePixels(src, 1024);
      return autoChecks(measureConcept(rgba, width, height), input.brief, checks, input.signatures);
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

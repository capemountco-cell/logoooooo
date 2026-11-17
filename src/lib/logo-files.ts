import { downloadFile, isMobileSaveDevice } from "@/lib/save-png";
import { svgToAi } from "@/lib/ai-export";
import { svgToEps } from "@/lib/eps-export";

export function logoFile(href: string, name: string, type: string) {
  const bin = href.startsWith("data:") && href.includes(";base64,")
    ? Uint8Array.from(atob(href.split(",")[1] ?? ""), (c) => c.charCodeAt(0))
    : new TextEncoder().encode(href);
  return new File([bin], name, { type });
}

/** The Illustrator file for an SVG: PDF-compatible .ai, which Illustrator opens as editable paths. */
export function aiFile(svg: string, name: string) {
  return new File([new TextEncoder().encode(svgToAi(svg, name))], `${name}.ai`, { type: "application/pdf" });
}

export type EpsFiles = { cmyk: File; rgb: File };

/** EPS vectors in both colour modes: Print (CMYK) and Digital (RGB), as stock sites ask for. */
export function epsFiles(svg: string, name: string): EpsFiles {
  const make = (mode: "cmyk" | "rgb", suffix: string) =>
    new File([new TextEncoder().encode(svgToEps(svg, name, mode))], `${name}-${suffix}.eps`, { type: "application/postscript" });
  return { cmyk: make("cmyk", "print-cmyk"), rgb: make("rgb", "digital-rgb") };
}

export async function flattenLogo(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not read your logo.");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Could not prepare your logo.");
    return new File([blob], "upload.png", { type: "image/png" });
  } finally { bitmap.close(); }
}

/** Saves a vector file (SVG, AI or EPS): share sheet on mobile, download on desktop. */
export function saveLogoSvg(file: File) {
  return saveFiles([file]);
}

/** Saves several files at once (e.g. both EPS colour modes): one share sheet on mobile, downloads on desktop. */
export function saveFiles(files: File[]) {
  if (isMobileSaveDevice() && navigator.canShare?.({ files }) && typeof navigator.share === "function") {
    return navigator.share({ files });
  }
  files.forEach((f, i) => setTimeout(() => downloadFile(f), i * 250));
  return Promise.resolve();
}
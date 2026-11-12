// A chosen concept → an exact-trace result (browser only). The generated image is vectorized
// exactly like an uploaded file, so every concept exports as SVG, AI and PNG.
import { toColorOutputs, toOutputs } from "@/lib/logo-convert";
import { buildResult, type LogoResult } from "@/lib/result-model";
import { baseName } from "@/components/app/modes";
import type { Provider } from "@/lib/concept-prompt";
import { cleanConcept } from "@/lib/concept-client";

export type TracedConcept = { src: string; mono: LogoResult; color?: LogoResult; name: string; detail: string };

const PROVIDER = { openai: "OpenAI", grok: "Grok" } as const;

export function conceptName(brandName: string, index: number) {
  return `${baseName(brandName || "logo")}-${index + 1}`;
}

/** Traces black & white, and colour too when the concept relies on colour (designed logos usually do). */
export async function traceConcept(original: string, name: string, provider: Provider): Promise<TracedConcept> {
  const detail = `AI concept · ${PROVIDER[provider]}`;
  // Specks and compression noise are removed first, so they never become stray paths.
  const src = await cleanConcept(original);
  const o = await toOutputs(src);
  const mono = buildResult(o, { name, mode: "trace", accuracy: { kind: "pixel", value: o.accuracy }, original: src, detail });
  if (o.advice.recommend !== "color") return { src, mono, name, detail };
  return { src, mono, color: await traceColorConcept(src, name, detail), name, detail };
}

export async function traceColorConcept(src: string, name: string, detail: string): Promise<LogoResult> {
  const c = await toColorOutputs(src);
  return buildResult(c, { name, mode: "trace", accuracy: { kind: "color", value: c.accuracy }, original: src, detail: `${detail} · colour`, variant: "color" });
}

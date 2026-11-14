import { useEffect, useState } from "react";
import { whiteToArtboard } from "@/lib/artboard";
import { Eye, Loader2, X } from "lucide-react";
import type { CheckDef } from "@/lib/concept-prompt";
import type { ConceptState } from "@/lib/concept-pipeline";
import type { ConceptPlan } from "@/lib/concept-plan";
import { cn } from "@/lib/utils";

const PROVIDER = { openai: "OpenAI", grok: "Grok" } as const;

/** The artboard grey from the theme (falls back to the default token). */
function artboardRgb(): [number, number, number] {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue("--artboard").trim();
    const m = v.match(/^#([0-9a-f]{6})$/i);
    if (m) { const n = parseInt(m[1]!, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  } catch { /* use the default */ }
  return [220, 220, 219];
}

/**
 * The concept image with its white background turned artboard grey and its colours untouched
 * (see artboard.ts). Falls back to the original until ready or if the canvas is unavailable.
 */
function useArtboardImage(src: string | null, enabled: boolean) {
  const [out, setOut] = useState<string | null>(null);
  useEffect(() => {
    setOut(null);
    if (!src || !enabled) return;
    let live = true, url: string | null = null;
    (async () => {
      const bitmap = await createImageBitmap(await (await fetch(src)).blob());
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      ctx.putImageData(new ImageData(new Uint8ClampedArray(whiteToArtboard(data.data, artboardRgb())), canvas.width, canvas.height), 0, 0);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
      if (!blob || !live) return;
      url = URL.createObjectURL(blob);
      setOut(url);
    })().catch(() => {});
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [src, enabled]);
  return out ?? src;
}

/** Notes: non-blocking boxes a shown concept didn't tick. */
export function noteCount(c: ConceptState, checks: CheckDef[]) {
  return c.results.filter((r) => !r.pass && !checks.find((d) => d.id === r.id)?.blocking).length;
}

export function stageLabel(c: ConceptState, total: number, notes = 0) {
  const failed = c.results.filter((r) => !r.pass).length;
  switch (c.stage) {
    case "queued": return "Waiting";
    case "drawing": return "Drawing";
    case "redrawing": return "Starting fresh";
    case "checking": return `Checking ${total} boxes`;
    case "fixing": return failed ? `Fixing ${failed} issue${failed === 1 ? "" : "s"}` : "Fixing";
    case "waiting": return c.note || "Retrying shortly";
    case "passed": return notes ? `Passed · ${notes} note${notes === 1 ? "" : "s"}` : `Passed ${total}/${total}`;
    case "failed": return c.note === "Stopped" || c.note === "Interrupted" ? c.note : "Not shown";
  }
}

const DIRECTION_NAMES = ["Geometric", "Bold", "Refined", "Warm"] as const;
/** The creative direction a concept was drawn in (concept-prompt.ts DIRECTIONS, by index). */
export const directionName = (index: number) => DIRECTION_NAMES[index % DIRECTION_NAMES.length]!;

type Tone = "pending" | "success" | "destructive" | "muted";

/** The status colour of a concept: yellow while working, green passed, red not shown. */
export function conceptTone(c: ConceptState, revealed = false): Tone {
  if (c.stage === "passed") return "success";
  if (c.stage === "failed") return revealed ? "pending" : c.note === "Stopped" || c.note === "Interrupted" ? "muted" : "destructive";
  return c.stage === "queued" ? "muted" : "pending";
}

function ToneDot({ tone }: { tone: Tone }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block h-2 w-2 shrink-0 rounded-full",
        tone === "pending" && "bg-pending",
        tone === "success" && "bg-success",
        tone === "destructive" && "bg-destructive",
        tone === "muted" && "border-[1.5px] border-muted-foreground",
      )}
    />
  );
}

/** One check as a list row: dot, label, and the issue or note when it didn't pass. */
function CheckRow({ def, concept }: { def: CheckDef; concept: ConceptState }) {
  const r = concept.results.find((x) => x.id === def.id);
  const failed = concept.stage === "failed";
  const tone: Tone = !r ? "muted" : r.pass ? "success" : !def.blocking ? "pending" : failed ? "destructive" : "pending";
  const state = !r ? "Not checked yet" : r.pass ? "Passed" : !def.blocking ? "Note" : failed ? "Failed" : "Being fixed";
  return (
    <li className="flex min-h-[34px] items-center gap-2.5 border-b border-border/50 px-4 py-1.5 last:border-b-0" title={r && !r.pass ? r.issue : undefined}>
      <ToneDot tone={tone} />
      <span className="sr-only">{state}: </span>
      <span className={cn("min-w-0 flex-1 truncate", !r && "text-muted-foreground")}>{def.label}</span>
      {r && !r.pass && <span className={cn("shrink-0 text-[12px]", tone === "destructive" ? "text-destructive" : "text-pending")}>{!def.blocking ? "note" : failed ? "failed" : "fixing"}</span>}
    </li>
  );
}

/**
 * One concept as a card (Camu's group style): the artwork on its grey artboard, then a footer row
 * with a status dot, the creative direction and the AI that drew it. Click selects (details show in
 * the side panel); double-click, or Enter on a selected card, opens it for export. The artwork stays
 * blurred until every blocking box passes; a concept that still fails is hidden behind "Show anyway".
 */
export function ConceptTile({
  concept, checks, onPick, onSelect, selected, label, revealed = false, onReveal, compact, title,
}: {
  concept: ConceptState;
  checks: CheckDef[];
  onPick?: (() => void) | undefined;
  onSelect?: (() => void) | undefined;
  selected?: boolean | undefined;
  label?: string | undefined;
  revealed?: boolean;
  onReveal?: (() => void) | undefined;
  compact?: boolean;
  /** The planned idea's name (concept-plan.ts); the creative lean name for older rounds. */
  title?: string | undefined;
}) {
  const failed = concept.stage === "failed";
  const shown = concept.stage === "passed" || (failed && revealed && Boolean(concept.image));
  const notes = noteCount(concept, checks);
  const display = useArtboardImage(concept.image, shown);
  const working = !shown && !failed;
  const name = label ?? `Concept ${concept.index + 1}`;
  const tone = conceptTone(concept, revealed);
  const status = failed && revealed ? "Shown anyway" : stageLabel(concept, checks.length, notes);
  const idea = title || directionName(concept.index);

  if (compact) {
    return (
      <button
        type="button"
        onClick={onSelect ?? onPick}
        disabled={!shown}
        aria-label={`${name} (${PROVIDER[concept.provider]}): ${status}`}
        aria-pressed={selected}
        title={status}
        className={cn("relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg border disabled:cursor-default", shown ? "border-border bg-artboard" : "border-border bg-card-head", selected ? "border-primary ring-1 ring-primary" : "")}
      >
        {concept.image && (!failed || shown) && <img src={shown ? (display ?? concept.image) : concept.image} alt="" className={cn("h-full w-full object-contain", working && "scale-110 opacity-40 blur-xl")} />}
        {working && <Loader2 className="absolute h-4 w-4 animate-spin text-pending" aria-hidden="true" />}
        {failed && !shown && <X className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
      </button>
    );
  }

  return (
    <article
      aria-label={`${name}, ${idea} (${PROVIDER[concept.provider]})`}
      className={cn("group flex flex-col overflow-hidden rounded-xl border bg-card transition-colors", selected ? "border-primary shadow-[0_0_0_1px_var(--color-primary)]" : "border-border hover:border-input")}
    >
      <button
        type="button"
        onClick={onSelect}
        onDoubleClick={shown ? onPick : undefined}
        aria-pressed={selected}
        aria-label={`${shown ? "Select" : "Show details of"} ${name.toLowerCase()}`}
        className={cn("relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden", shown ? "bg-artboard" : "bg-card-head")}
      >
        {concept.image && (!failed || shown) && (
          <img src={shown ? (display ?? concept.image) : concept.image} alt={shown ? `Logo ${name.toLowerCase()}` : ""} className={cn("h-full w-full object-contain transition-[filter,opacity,transform] duration-700", working && "scale-110 opacity-40 blur-2xl")} />
        )}
        {working && (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center text-subtle">
            <Loader2 className="h-5 w-5 animate-spin text-pending" aria-hidden="true" />
            <span className="text-[13px]">{status}</span>
            {(concept.fixes > 0 || concept.redraws > 0) && <span className="text-[11px] text-muted-foreground">{concept.redraws ? "fresh drawing · " : ""}fix {concept.fixes} of 2</span>}
          </span>
        )}
        {failed && !shown && (
          <span className="flex flex-col items-center gap-1.5 px-5 text-center text-muted-foreground">
            <X className="h-5 w-5" aria-hidden="true" />
            <span className="text-[13px]">{concept.note === "Stopped" || concept.note === "Interrupted" ? concept.note : "Didn't pass every check"}</span>
          </span>
        )}
      </button>
      <div className="flex h-[38px] items-center gap-2 border-t border-border px-3">
        <ToneDot tone={tone} />
        <span className="truncate font-medium" title={idea}>{idea}</span>
        {shown && notes > 0 && <span className="shrink-0 text-[12px] text-pending">· {notes} note{notes === 1 ? "" : "s"}</span>}
        {failed && revealed && <span className="shrink-0 text-[12px] text-pending">· shown anyway</span>}
        <span className="flex-1" />
        {failed && !shown && concept.image && concept.note !== "Stopped" && onReveal ? (
          <button type="button" onClick={onReveal} className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[12px] font-medium text-subtle hover:bg-secondary hover:text-foreground">
            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
            Show anyway
          </button>
        ) : (
          <span className="shrink-0 text-[12px] text-muted-foreground">{PROVIDER[concept.provider]}</span>
        )}
      </div>
    </article>
  );
}

/** Hex colours named in the brief ("Primary Ember #C2410C"), for the palette card. */
export function briefSwatches(colors: string[]) {
  return colors
    .map((c) => {
      const hex = c.match(/#[0-9a-f]{6}\b/i)?.[0];
      return hex ? { hex: hex.toUpperCase(), name: c.replace(hex, "").replace(/^(primary|accent|neutral|secondary)\s+/i, "").trim() || hex.toUpperCase() } : null;
    })
    .filter((x): x is { hex: string; name: string } => Boolean(x));
}

/** The side panel for the selected concept: its checks, the palette, and the export action. */
export function ConceptDetail({
  concept, checks, label, colors, revealed, onOpen, opening, plan,
}: {
  concept: ConceptState | null;
  checks: CheckDef[];
  label: string;
  colors: string[];
  revealed: boolean;
  onOpen: () => void;
  opening?: boolean;
  plan?: ConceptPlan | undefined;
}) {
  if (!concept) {
    return <p className="px-1 py-2 text-[13px] text-muted-foreground">Select a concept to see its checks.</p>;
  }
  const passedCount = concept.results.filter((r) => r.pass).length;
  const usable = concept.stage === "passed" || (concept.stage === "failed" && revealed && Boolean(concept.image));
  const swatches = briefSwatches(colors);
  return (
    <>
      <div className="flex h-[30px] items-center gap-2">
        <span className="font-semibold">{label}</span>
        <span className="truncate text-muted-foreground">{plan?.name || directionName(concept.index)} · {PROVIDER[concept.provider]}</span>
      </div>
      {plan?.idea && <p className="-mt-1.5 text-[12px] leading-relaxed text-subtle">{plan.idea}</p>}
      <section className="overflow-hidden rounded-xl border border-border bg-card" aria-label="Checks">
        <div className="flex h-9 items-center gap-2 border-b border-border bg-card-head px-4 font-medium text-subtle">
          Checks <span className="text-muted-foreground tabular-nums">{passedCount} of {checks.length}</span>
        </div>
        <ul>
          {checks.map((d) => <CheckRow key={d.id} def={d} concept={concept} />)}
        </ul>
      </section>
      {swatches.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-border bg-card" aria-label="Palette">
          <div className="flex h-9 items-center border-b border-border bg-card-head px-4 font-medium text-subtle">Palette</div>
          <div className="flex gap-2 px-4 pt-3">
            {swatches.map((s) => <span key={s.hex} className="h-7 flex-1 rounded-md shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]" style={{ background: s.hex }} title={`${s.name} ${s.hex}`} />)}
          </div>
          <p className="px-4 pt-2 pb-3 text-[12px] text-muted-foreground">{swatches.map((s) => `${s.name} ${s.hex}`).join(" · ")}</p>
        </section>
      )}
      <span className="flex-1" />
      <button type="button" disabled={!usable || opening} onClick={onOpen} className="inline-flex h-[34px] flex-none items-center justify-center gap-2 rounded-lg bg-primary text-[13px] font-semibold text-primary-foreground disabled:opacity-40">
        {opening ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
        Trace &amp; export
        <span className="hidden sm:inline-flex"><kbd className="kbd font-sans">↵</kbd></span>
      </button>
    </>
  );
}

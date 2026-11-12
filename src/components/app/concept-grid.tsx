import { useEffect, useState } from "react";
import { whiteToArtboard } from "@/lib/artboard";
import { ArrowUpRight, Check, ChevronDown, Circle, CircleAlert, Eye, Loader2, RotateCcw, X } from "lucide-react";
import type { CheckDef } from "@/lib/concept-prompt";
import type { ConceptState } from "@/lib/concept-pipeline";
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
    case "failed": return c.note === "Stopped" ? "Stopped" : "Not shown";
  }
}

function Checklist({ concept, checks }: { concept: ConceptState; checks: CheckDef[] }) {
  const failed = concept.stage === "failed";
  return (
    <ul className="grid grid-cols-1 gap-x-3 gap-y-1.5 pt-1" aria-label="Quality checks">
      {checks.map((c) => {
        const r = concept.results.find((x) => x.id === c.id);
        return (
          <li key={c.id} className="flex items-center gap-1.5 text-[12px] text-subtle" title={r && !r.pass ? r.issue : undefined}>
            {!r ? (
              <Circle className="h-3 w-3 shrink-0 text-line" aria-label="Not checked yet" />
            ) : r.pass ? (
              <Check className="h-3.5 w-3.5 shrink-0 text-success" aria-label="Passed" />
            ) : !c.blocking ? (
              <CircleAlert className="h-3.5 w-3.5 shrink-0 text-pending" aria-label="Note" />
            ) : failed ? (
              <X className="h-3.5 w-3.5 shrink-0 text-destructive" aria-label="Failed" />
            ) : (
              <RotateCcw className="h-3 w-3 shrink-0 text-pending" aria-label="Being fixed" />
            )}
            <span className="truncate">{c.label}</span>
            {!c.blocking && r && !r.pass && <span className="shrink-0 text-[10.5px] text-muted-foreground">note</span>}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * One concept. The artwork stays blurred until every blocking box passes; boxes that aren't
 * blocking show as notes. A concept that still fails is hidden, with "Show anyway" to reveal it.
 */
export function ConceptTile({ concept, checks, onPick, compact, selected, label }: { concept: ConceptState; checks: CheckDef[]; onPick?: () => void; compact?: boolean; selected?: boolean; label?: string }) {
  const [open, setOpen] = useState(false);
  const [reveal, setReveal] = useState(false);
  const failed = concept.stage === "failed";
  // A failed concept the user chose to see anyway behaves like a shown one (they can use it).
  const shown = concept.stage === "passed" || (failed && reveal && Boolean(concept.image));
  const passed = shown;
  const notes = noteCount(concept, checks);
  const display = useArtboardImage(concept.image, shown);
  const working = !passed && !failed;
  const done = concept.results.filter((r) => r.pass).length;
  const name = label ?? `Concept ${concept.index + 1}`;
  return (
    <article aria-label={`${name} (${PROVIDER[concept.provider]})`} className="group flex flex-col gap-2.5">
      <button
        type="button"
        disabled={!passed || !onPick}
        onClick={onPick}
        aria-label={passed ? `Use ${name.toLowerCase()}` : undefined}
        className={cn(
          "relative flex aspect-square w-full items-center justify-center overflow-hidden disabled:cursor-default",
          compact ? "rounded-[12px]" : "rounded-[18px]",
          passed ? "bg-artboard" : "bg-field",
          selected && "ring-2 ring-foreground ring-offset-2 ring-offset-background",
        )}
      >
        {concept.image && (!failed || shown) && (
          <img src={shown ? (display ?? concept.image) : concept.image} alt={passed ? `Logo ${name.toLowerCase()}` : ""} className={cn("h-full w-full object-contain transition-[filter,opacity,transform] duration-700", working && "scale-110 opacity-45 blur-2xl")} />
        )}
        {working && (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/30 text-center">
            <Loader2 className={cn("animate-spin text-white", compact ? "h-4 w-4" : "h-5 w-5")} aria-hidden="true" />
            {!compact && <span className="text-[13px] font-medium text-white">{stageLabel(concept, checks.length, notes)}</span>}
            {!compact && (concept.fixes > 0 || concept.redraws > 0) && (
              <span className="font-mono text-[10.5px] text-white/60">{concept.redraws ? "fresh drawing · " : ""}fix round {concept.fixes}</span>
            )}
          </span>
        )}
        {failed && !shown && (
          <span className="flex flex-col items-center gap-1.5 px-5 text-center">
            <X className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            {!compact && <span className="text-[13px] text-muted-foreground">{concept.note === "Stopped" ? "Stopped" : concept.note || "Didn't pass every check"}</span>}
          </span>
        )}
        {failed && shown && !compact && (
          <span className="absolute top-3 left-3 rounded-full bg-black/80 px-2.5 py-1 text-[11px] font-medium text-white">Didn't pass every check</span>
        )}
        {passed && onPick && !compact && (
          <span className="absolute right-3 bottom-3 inline-flex h-9 items-center gap-1.5 rounded-full bg-black px-3.5 text-[13px] font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            Use this logo
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
        )}
      </button>

      {compact ? (
        <div className="flex items-center justify-between gap-1 px-0.5" title={stageLabel(concept, checks.length, notes)}>
          <span className="font-mono text-[10px] tracking-[0.04em] text-muted-foreground uppercase">{PROVIDER[concept.provider]}</span>
          {passed ? <Check className="h-3.5 w-3.5 text-success" aria-label={stageLabel(concept, checks.length, notes)} /> : failed ? <X className="h-3.5 w-3.5 text-muted-foreground" aria-label="Not shown" /> : <Loader2 className="h-3.5 w-3.5 animate-spin text-subtle" aria-label={stageLabel(concept, checks.length, notes)} />}
        </div>
      ) : (
        <div className="flex flex-col gap-2 px-0.5">
          <div className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="hidden truncate text-[13px] font-medium sm:inline">{name}</span>
              <span className="font-mono text-[10.5px] tracking-[0.04em] text-muted-foreground uppercase">{PROVIDER[concept.provider]}</span>
            </span>
            <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={`${failed && shown ? "Shown anyway" : stageLabel(concept, checks.length, notes)} — show checks`} className={cn("inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-1.5 text-xs font-medium", concept.stage === "passed" ? (notes ? "text-pending" : "text-success") : "text-subtle")}>
              {failed && shown ? "Shown anyway" : stageLabel(concept, checks.length, notes)}
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} aria-hidden="true" />
            </button>
          </div>
          <div className="h-[3px] overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Checks passed" aria-valuemin={0} aria-valuemax={checks.length} aria-valuenow={done}>
            <div className={cn("h-full rounded-full transition-[width] duration-500", concept.stage === "passed" ? (notes ? "bg-pending" : "bg-success") : failed ? "bg-line" : "bg-foreground")} style={{ width: `${checks.length ? (done / checks.length) * 100 : 0}%` }} />
          </div>
          {open && <Checklist concept={concept} checks={checks} />}
          {failed && !shown && concept.image && concept.note !== "Stopped" && (
            <button type="button" onClick={() => { setReveal(true); setOpen(true); }} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-full border border-border text-[13px] font-medium text-subtle hover:text-foreground">
              <Eye className="h-3.5 w-3.5" aria-hidden="true" />
              Show anyway
            </button>
          )}
        </div>
      )}
    </article>
  );
}

export function ConceptGrid({ concepts, checks, onPick, offset = 0 }: { concepts: ConceptState[]; checks: CheckDef[]; onPick: (c: ConceptState) => void; offset?: number }) {
  return (
    <div className="grid w-full grid-cols-2 gap-x-4 gap-y-6 sm:gap-x-5 lg:grid-cols-4">
      {concepts.map((c) => (
        <ConceptTile key={c.index} concept={c} checks={checks} onPick={() => onPick(c)} label={`Concept ${offset + c.index + 1}`} />
      ))}
    </div>
  );
}

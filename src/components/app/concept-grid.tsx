import { Check, Circle, Loader2, RotateCcw, X } from "lucide-react";
import type { CheckDef } from "@/lib/concept-prompt";
import type { ConceptState } from "@/lib/concept-pipeline";
import { cn } from "@/lib/utils";

const PROVIDER = { openai: "OpenAI", grok: "Grok" } as const;

export function stageLabel(c: ConceptState, total: number) {
  const failed = c.results.filter((r) => !r.pass).length;
  switch (c.stage) {
    case "queued": return "Waiting";
    case "drawing": return "Drawing";
    case "redrawing": return "Starting fresh";
    case "checking": return `Checking ${total} boxes`;
    case "fixing": return `Fixing ${failed || ""} issue${failed === 1 ? "" : "s"}`.replace("  ", " ");
    case "waiting": return c.note || "Retrying shortly";
    case "passed": return `Passed all ${total} checks`;
    case "failed": return "Not shown";
  }
}

/** One concept: hidden (blurred) until every box passes, with its checklist ticking off. */
export function ConceptTile({ concept, checks, onPick, compact, selected }: { concept: ConceptState; checks: CheckDef[]; onPick?: () => void; compact?: boolean; selected?: boolean }) {
  const passed = concept.stage === "passed";
  const failed = concept.stage === "failed";
  const working = !passed && !failed;
  const result = (id: string) => concept.results.find((r) => r.id === id);
  return (
    <article
      aria-label={`Concept ${concept.index + 1} (${PROVIDER[concept.provider]})`}
      className={cn("flex flex-col overflow-hidden rounded-[18px] border bg-card", selected ? "border-foreground ring-1 ring-foreground" : "border-border")}
    >
      <button
        type="button"
        disabled={!passed || !onPick}
        onClick={onPick}
        aria-label={passed ? `Use concept ${concept.index + 1}` : undefined}
        className="relative flex aspect-square w-full items-center justify-center overflow-hidden bg-white disabled:cursor-default"
      >
        {concept.image && !failed && (
          <img src={concept.image} alt={passed ? `Logo concept ${concept.index + 1}` : ""} className={cn("h-full w-full object-contain transition-[filter,opacity] duration-500", working && "scale-105 opacity-40 blur-xl")} />
        )}
        {working && (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
            <Loader2 className="h-5 w-5 animate-spin text-subtle" aria-hidden="true" />
            {!compact && <span className="text-[13px] font-medium text-subtle">{stageLabel(concept, checks.length)}</span>}
            {!compact && (concept.fixes > 0 || concept.redraws > 0) && (
              <span className="font-mono text-[10.5px] text-muted-foreground">
                {concept.redraws ? "fresh drawing · " : ""}fix round {concept.fixes}
              </span>
            )}
          </span>
        )}
        {failed && (
          <span className="flex flex-col items-center gap-1.5 px-5 text-center">
            <X className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            {!compact && <span className="text-[13px] font-medium text-subtle">{concept.note || "Didn't pass every check"}</span>}
          </span>
        )}
      </button>
      <div className={cn("flex flex-col gap-2 border-t border-border p-3", compact && "p-2")}>
        {compact ? (
          <div className="flex items-center justify-between gap-1" title={stageLabel(concept, checks.length)}>
            <span className="font-mono text-[10px] tracking-[0.04em] text-muted-foreground uppercase">{PROVIDER[concept.provider]}</span>
            {passed ? (
              <Check className="h-3.5 w-3.5 text-emerald-600" aria-label={stageLabel(concept, checks.length)} />
            ) : failed ? (
              <X className="h-3.5 w-3.5 text-muted-foreground" aria-label="Not shown" />
            ) : (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-subtle" aria-label={stageLabel(concept, checks.length)} />
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[10.5px] tracking-[0.04em] text-muted-foreground uppercase">{PROVIDER[concept.provider]}</span>
            <span className={cn("text-xs font-medium", passed ? "text-emerald-700" : failed ? "text-muted-foreground" : "text-subtle")}>{stageLabel(concept, checks.length)}</span>
          </div>
        )}
        {!compact && (
          <ul className="grid grid-cols-1 gap-x-3 gap-y-1 sm:grid-cols-2" aria-label="Quality checks">
            {checks.map((c) => {
              const r = result(c.id);
              return (
                <li key={c.id} className="flex items-center gap-1.5 text-[12px] text-subtle" title={r && !r.pass ? r.issue : undefined}>
                  {!r ? (
                    <Circle className="h-3 w-3 shrink-0 text-[#CFCFCB]" aria-label="Not checked yet" />
                  ) : r.pass ? (
                    <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-label="Passed" />
                  ) : failed ? (
                    <X className="h-3.5 w-3.5 shrink-0 text-destructive" aria-label="Failed" />
                  ) : (
                    <RotateCcw className="h-3 w-3 shrink-0 text-amber-600" aria-label="Being fixed" />
                  )}
                  <span className="truncate">{c.label}</span>
                </li>
              );
            })}
          </ul>
        )}
        {passed && onPick && !compact && (
          <button type="button" onClick={onPick} className="mt-1 inline-flex h-10 items-center justify-center rounded-[11px] bg-primary text-[13px] font-semibold text-primary-foreground">
            Use this logo
          </button>
        )}
      </div>
    </article>
  );
}

export function ConceptGrid({ concepts, checks, onPick }: { concepts: ConceptState[]; checks: CheckDef[]; onPick: (c: ConceptState) => void }) {
  return (
    <div className="grid w-full max-w-[920px] grid-cols-1 gap-3.5 sm:grid-cols-2">
      {concepts.map((c) => (
        <ConceptTile key={c.index} concept={c} checks={checks} onPick={() => onPick(c)} />
      ))}
    </div>
  );
}

import { useMemo } from "react";
import { ArrowRight, Loader2, Scissors } from "lucide-react";
import type { PreparedRef } from "@/lib/concept-client";
import { cleanPastedBrief } from "@/lib/clean-paste";
import { ReferencePicker } from "./reference-picker";

/**
 * The one input the app starts with: a brief in your own words, or pasted straight from a web
 * page or email. Page clutter (menus, footers, links, legal text) is stripped before the AI reads it.
 */
export function BriefComposer({
  notes, onNotes, refs, onRefs, busy, onGenerate, onReview, onCancel, error,
}: {
  notes: string;
  onNotes: (v: string) => void;
  refs: PreparedRef[];
  onRefs: (r: PreparedRef[]) => void;
  busy: boolean;
  onGenerate: () => void;
  onReview: () => void;
  onCancel: () => void;
  error: string | null;
}) {
  const canSubmit = notes.trim().length >= 3 && !busy;
  const removed = useMemo(() => (notes.length > 200 ? cleanPastedBrief(notes).removed : 0), [notes]);
  return (
    <section aria-label="Logo brief" className="flex w-full max-w-[760px] flex-col gap-3 rounded-[24px] border border-border bg-card p-3">
      <label className="flex flex-col">
        <span className="sr-only">Brief</span>
        <textarea
          value={notes}
          onChange={(e) => onNotes(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canSubmit) onGenerate(); }}
          disabled={busy}
          rows={6}
          placeholder={"Write or paste a brief…\n\nType it however it comes to mind, or paste a whole page — a job post, contest listing or email. Menus, footers and links are cleaned out."}
          className="max-h-[50vh] min-h-[176px] w-full resize-y rounded-[16px] bg-field px-4 py-3.5 text-base leading-relaxed outline-none placeholder:text-muted-foreground focus:bg-field-focus disabled:opacity-60"
        />
      </label>
      {removed > 0 && (
        <p className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground" role="status">
          <Scissors className="h-3.5 w-3.5" aria-hidden="true" />
          {removed} line{removed === 1 ? "" : "s"} of page clutter will be left out.
        </p>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <ReferencePicker refs={refs} onChange={onRefs} disabled={busy} />
        {busy ? (
          <button type="button" onClick={onCancel} className="inline-flex h-[46px] items-center gap-2 rounded-full border border-border px-4 text-[15px] font-medium">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Reading brief… Cancel
          </button>
        ) : (
          <div className="flex w-full items-center gap-1.5 sm:w-auto">
            <button type="button" onClick={onReview} disabled={!canSubmit} className="inline-flex h-[46px] items-center whitespace-nowrap rounded-full px-3.5 text-sm font-medium text-subtle hover:text-foreground disabled:opacity-40">
              Review brief<span className="hidden sm:inline">&nbsp;first</span>
            </button>
            <button
              type="button"
              onClick={onGenerate}
              disabled={!canSubmit}
              className="inline-flex h-[46px] flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-primary px-5 text-[15px] font-semibold text-primary-foreground transition-opacity disabled:opacity-30 sm:flex-none"
            >
              Generate concepts
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
      {error && <p role="alert" className="px-1 text-sm text-destructive">{error}</p>}
    </section>
  );
}

import { ArrowUp, Loader2 } from "lucide-react";
import type { PreparedRef } from "@/lib/concept-client";
import { ReferencePicker } from "./reference-picker";

/** The one input the app starts with: describe the logo in your own words. */
export function BriefComposer({
  notes, onNotes, refs, onRefs, busy, onSubmit, onCancel, error,
}: {
  notes: string;
  onNotes: (v: string) => void;
  refs: PreparedRef[];
  onRefs: (r: PreparedRef[]) => void;
  busy: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  error: string | null;
}) {
  const canSubmit = notes.trim().length >= 3 && !busy;
  return (
    <section
      aria-label="Logo brief"
      className="flex w-full max-w-[720px] flex-col gap-3 rounded-[22px] border border-border bg-card p-3.5 shadow-[0_1px_2px_rgba(17,17,17,0.04),0_18px_48px_rgba(17,17,17,0.07)]"
    >
      <label className="flex flex-col">
        <span className="sr-only">Describe your logo</span>
        <textarea
          value={notes}
          onChange={(e) => onNotes(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canSubmit) onSubmit(); }}
          disabled={busy}
          rows={5}
          placeholder={"Describe your logo however it comes to mind…\ne.g. coffee shop called Ember, cosy but modern, maybe a flame, warm colours, no cups"}
          className="min-h-[148px] w-full resize-none rounded-[14px] bg-[#FAFAF8] px-4 py-3.5 text-base leading-relaxed outline-none placeholder:text-muted-foreground focus:bg-white disabled:opacity-60"
        />
      </label>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <ReferencePicker refs={refs} onChange={onRefs} disabled={busy} />
        {busy ? (
          <button type="button" onClick={onCancel} className="inline-flex h-[46px] items-center gap-2 rounded-xl border border-border bg-card px-4 text-[15px] font-medium">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Reading your brief… Cancel
          </button>
        ) : (
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit}
            className="inline-flex h-[46px] items-center gap-2 rounded-xl bg-primary px-5 text-[15px] font-semibold text-primary-foreground transition-opacity disabled:opacity-40"
          >
            Write brief
            <ArrowUp className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
      {error && <p role="alert" className="px-1 text-sm text-destructive">{error}</p>}
    </section>
  );
}

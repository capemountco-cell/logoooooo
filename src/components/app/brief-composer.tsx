import { useMemo, useRef, useState } from "react";
import { ArrowRight, FileText, Loader2, Scissors } from "lucide-react";
import { extractBrief, type PreparedRef } from "@/lib/concept-client";
import { BRIEF_FILE_ACCEPT } from "@/lib/brief-extract";
import { cleanPastedBrief } from "@/lib/clean-paste";
import { useImageDrop } from "@/hooks/use-image-drop";
import { cn } from "@/lib/utils";
import { ReferencePicker } from "./reference-picker";

/**
 * The one input the app starts with: a brief in your own words, pasted straight from a web page or
 * email, or uploaded as a screenshot, PDF or text file (read into the box so it can be checked).
 * Page clutter (menus, footers, links, legal text) is stripped before the AI reads it.
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
  const [reading, setReading] = useState(false);
  const [readNote, setReadNote] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const locked = busy || reading;
  const canSubmit = notes.trim().length >= 3 && !locked;
  const removed = useMemo(() => (notes.length > 200 ? cleanPastedBrief(notes).removed : 0), [notes]);

  async function read(file: File) {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setReading(true);
    setReadError(null);
    setReadNote(null);
    try {
      const { text, sections } = await extractBrief(file, ctl.signal);
      if (ctl.signal.aborted) return;
      onNotes(notes.trim() ? `${notes.trim()}\n\n${text}` : text);
      setReadNote(file.type.startsWith("image/") ? `Read from your screenshot${sections > 1 ? ` (${sections} sections)` : ""}. Check it, then generate.` : "Read from your file. Check it, then generate.");
    } catch (e) {
      if (!ctl.signal.aborted) setReadError(e instanceof Error ? e.message.replace(/^\d{3}\s/, "") : "Couldn't read that brief.");
    } finally {
      if (abort.current === ctl) setReading(false);
    }
  }

  // Screenshots can be dropped onto the brief box or pasted into it (⌘V / Ctrl+V).
  const drop = useImageDrop((files) => { const f = files[0]; if (f) void read(f); }, locked);

  return (
    <section aria-label="Logo brief" className="flex w-full max-w-[760px] flex-col gap-3 rounded-[24px] border border-border bg-card p-3">
      <div className="relative flex flex-col" {...drop.handlers}>
        <textarea
          aria-label="Brief"
          value={notes}
          onChange={(e) => onNotes(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canSubmit) onGenerate(); }}
          onPaste={(e) => {
            const img = Array.from(e.clipboardData.files).find((f) => f.type.startsWith("image/"));
            if (img) { e.preventDefault(); void read(img); }
          }}
          disabled={locked}
          rows={6}
          placeholder={"Write, paste or upload a brief…\n\nType it however it comes to mind, paste a whole page — a job post, contest listing or email — or drop in a screenshot. Menus, footers and links are cleaned out."}
          className={cn(
            "max-h-[50vh] min-h-[176px] w-full resize-y rounded-[16px] bg-field px-4 py-3.5 text-base leading-relaxed outline-none placeholder:text-muted-foreground focus:bg-field-focus disabled:opacity-60",
            drop.dragging && "ring-2 ring-blue",
          )}
        />
        {reading && (
          <span className="absolute inset-0 flex items-center justify-center gap-2 rounded-[16px] bg-black/60 text-sm font-medium text-white" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Reading your brief…
            <button type="button" onClick={() => { abort.current?.abort(); setReading(false); }} className="ml-1 rounded-full border border-white/30 px-2.5 py-1 text-xs">Cancel</button>
          </span>
        )}
      </div>
      {(readNote || readError || removed > 0) && (
        <div className="flex flex-col gap-1 px-1 text-xs">
          {readNote && <p className="flex items-center gap-1.5 text-success" role="status"><FileText className="h-3.5 w-3.5" aria-hidden="true" />{readNote}</p>}
          {readError && <p className="text-destructive" role="alert">{readError}</p>}
          {removed > 0 && (
            <p className="flex items-center gap-1.5 text-muted-foreground" role="status">
              <Scissors className="h-3.5 w-3.5" aria-hidden="true" />
              {removed} line{removed === 1 ? "" : "s"} of page clutter will be left out.
            </p>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <label className={cn("inline-flex h-[52px] cursor-pointer items-center gap-2 rounded-xl border border-border px-3.5 text-[13px] font-medium text-subtle hover:text-foreground", locked && "pointer-events-none opacity-50")}>
              <FileText className="h-4 w-4" aria-hidden="true" />
              Upload brief
              <input type="file" accept={BRIEF_FILE_ACCEPT} disabled={locked} aria-label="Upload a brief (screenshot, PDF or text file)" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void read(f); }} />
            </label>
            <ReferencePicker refs={refs} onChange={onRefs} disabled={locked} />
          </div>
          {refs.length === 0 && <p className="px-1 text-xs text-muted-foreground">References are optional — LOGOO finds them for you, and you can review them after any round.</p>}
        </div>
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

import { useMemo, useRef, useState } from "react";
import { FileText, Link2, Loader2, Scissors, Sparkles } from "lucide-react";
import { extractBrief, type PreparedRef } from "@/lib/concept-client";
import { BRIEF_FILE_ACCEPT } from "@/lib/brief-extract";
import { cleanPastedBrief } from "@/lib/clean-paste";
import { useImageDrop } from "@/hooks/use-image-drop";
import { cn } from "@/lib/utils";
import { ReferencePicker } from "./reference-picker";
import { Btn, MOD } from "./mac";
import { findLinks } from "@/lib/link-reference";

const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };

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

  const links = useMemo(() => findLinks(notes), [notes]);

  return (
    <div className="flex w-full max-w-[760px] flex-col items-center gap-5">
      <section aria-label="Logo brief" className="w-full overflow-hidden rounded-[14px] border border-input bg-card shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_12px_32px_rgba(0,0,0,0.25)]">
        <div className="relative" {...drop.handlers}>
          <textarea
            aria-label="Brief"
            value={notes}
            onChange={(e) => onNotes(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canSubmit) { e.preventDefault(); onGenerate(); } }}
            onPaste={(e) => {
              const img = Array.from(e.clipboardData.files).find((f) => f.type.startsWith("image/"));
              if (img) { e.preventDefault(); void read(img); }
            }}
            disabled={locked}
            rows={8}
            autoFocus
            placeholder={"Write, paste or upload a brief…\n\nType it however it comes to mind, paste a whole page — a job post, contest listing or email — or drop in a screenshot. Links to a reference (\"style reference: https://…\") are opened and used for that role."}
            className={cn(
              "block max-h-[50vh] min-h-[200px] w-full resize-y bg-transparent px-5 py-4 text-[14px] leading-relaxed outline-none placeholder:text-muted-foreground disabled:opacity-60",
              drop.dragging && "bg-primary/5 ring-2 ring-primary ring-inset",
            )}
          />
          {reading && (
            <span className="absolute inset-0 flex items-center justify-center gap-2 bg-black/60 text-[13px] font-medium text-white" role="status">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Reading your brief…
              <button type="button" onClick={() => { abort.current?.abort(); setReading(false); }} className="ml-1 rounded-md border border-white/30 px-2 py-0.5 text-xs">Cancel</button>
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-border bg-[#1a1a1c] px-3 py-2.5">
          {links.map((l) => (
            <span key={l.url} className="inline-flex h-6 max-w-[260px] items-center gap-1.5 rounded-full bg-primary/15 px-2.5 text-[12px] font-medium text-[#a9b0f0]" title={`${l.url} — opened as a ${l.role} reference`}>
              <Link2 className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{hostOf(l.url)} · {l.role}</span>
            </span>
          ))}
          {readNote && <span className="inline-flex items-center gap-1.5 text-[12px] text-success" role="status"><FileText className="h-3.5 w-3.5" aria-hidden="true" />{readNote}</span>}
          {removed > 0 && (
            <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground" role="status">
              <Scissors className="h-3.5 w-3.5" aria-hidden="true" />
              {removed} clutter line{removed === 1 ? "" : "s"} left out
            </span>
          )}
          <span className="flex-1" />
          <label className={cn("inline-flex h-7 cursor-pointer items-center gap-2 rounded-lg border border-input bg-card px-3 text-[13px] font-medium hover:bg-secondary", locked && "pointer-events-none opacity-50")}>
            <FileText className="h-3.5 w-3.5" aria-hidden="true" />
            Upload brief
            <input type="file" accept={BRIEF_FILE_ACCEPT} disabled={locked} aria-label="Upload a brief (screenshot, PDF or text file)" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void read(f); }} />
          </label>
          <ReferencePicker refs={refs} onChange={onRefs} disabled={locked} />
        </div>
      </section>

      {readError && <p className="text-[13px] text-destructive" role="alert">{readError}</p>}

      {busy ? (
        <Btn size="md" onClick={onCancel} kbd="esc">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          Reading brief… Cancel
        </Btn>
      ) : (
        <div className="flex w-full items-center justify-center gap-2.5">
          <Btn size="md" onClick={onReview} disabled={!canSubmit}>Review<span className="hidden sm:inline">&nbsp;brief first</span></Btn>
          <Btn size="md" variant="primary" onClick={onGenerate} disabled={!canSubmit} kbd={`${MOD}↵`} className="flex-1 sm:flex-none">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            Generate concepts
          </Btn>
        </div>
      )}
      {error && <p role="alert" className="text-[13px] text-destructive">{error}</p>}
      {refs.length === 0 && !error && <p className="text-[12px] text-muted-foreground">References are optional — LOGOO finds them for you, and you can review them after any round.</p>}
    </div>
  );
}

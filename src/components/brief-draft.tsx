import { useEffect, useRef, useState } from "react";
import { FileText, Loader2, X } from "lucide-react";
import { BRIEF_FILE_ACCEPT } from "@/lib/brief-extract";
import { extractBrief } from "@/lib/concept-client";
import { useImageDrop } from "@/hooks/use-image-drop";
import { cn } from "@/lib/utils";

export type Draft = { id: string; notes: string; /** A file to read into this brief as soon as the card appears. */ file?: File | undefined };

/**
 * One brief waiting in a batch: type or paste it, or upload / drop / paste a screenshot, PDF or
 * text file (read into the card to check, exactly like Create). Nothing runs until Generate.
 */
export function BriefDraft({
  draft, index, onChange, onRemove, canRemove,
}: {
  draft: Draft;
  index: number;
  onChange: (notes: string) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const [reading, setReading] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const notesRef = useRef(draft.notes);
  notesRef.current = draft.notes;

  async function read(file: File) {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setReading(true);
    setError(null);
    setNote(null);
    try {
      const { text } = await extractBrief(file, ctl.signal);
      if (ctl.signal.aborted) return;
      const current = notesRef.current.trim();
      onChange(current ? `${current}\n\n${text}` : text);
      setNote(`Read from ${file.name || "your file"}`);
    } catch (e) {
      if (!ctl.signal.aborted) setError(e instanceof Error ? e.message.replace(/^\d{3}\s/, "") : "Couldn't read that brief.");
    } finally {
      if (abort.current === ctl) setReading(false);
    }
  }

  // A card added from "Upload briefs" reads its file straight away (once; cancelled on removal).
  useEffect(() => {
    if (draft.file) void read(draft.file);
    return () => abort.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.file]);

  const drop = useImageDrop((files) => { const f = files[0]; if (f) void read(f); }, reading);

  const [focused, setFocused] = useState(false);
  const firstLine = draft.notes.trim().split(/\n/)[0] ?? "";

  return (
    <li className="flex flex-col border-b border-border/50 last:border-b-0">
      <div className="flex items-start gap-3 px-4 py-2" {...drop.handlers}>
        <span className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-accent text-[11px] font-semibold text-muted-foreground tabular-nums">{index + 1}</span>
        <div className="relative min-w-0 flex-1">
          <textarea
            aria-label={`Brief ${index + 1}`}
            value={draft.notes}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onPaste={(e) => {
              const img = Array.from(e.clipboardData.files).find((f) => f.type.startsWith("image/"));
              if (img) { e.preventDefault(); void read(img); }
            }}
            disabled={reading}
            rows={focused ? 4 : !draft.notes ? 2 : 1}
            placeholder="Write, paste or drop in a brief — a screenshot, PDF or text file works too."
            title={!focused && firstLine ? draft.notes : undefined}
            className={cn(
              "block w-full resize-none rounded-lg border border-transparent bg-transparent px-2.5 py-1.5 text-[13px] leading-relaxed outline-none placeholder:text-muted-foreground focus:border-input focus:bg-field disabled:opacity-60",
              !focused && draft.notes && "truncate whitespace-nowrap",
              drop.dragging && "border-primary bg-primary/10",
            )}
          />
          {reading && (
            <span className="absolute inset-0 flex items-center gap-2 rounded-lg bg-card/90 px-2.5 text-[13px] text-subtle" role="status">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-pending" aria-hidden="true" />
              Reading brief…
            </span>
          )}
          {(note || error) && <p className={cn("px-2.5 pt-1 text-[12px]", error ? "text-destructive" : "text-success")} role={error ? "alert" : "status"}>{error ?? `${note}. Check it, then generate.`}</p>}
        </div>
        <div className="mt-1 flex shrink-0 items-center gap-1">
          <label className={cn("inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-lg border border-input bg-card px-2.5 text-[12px] font-medium text-subtle hover:text-foreground", reading && "pointer-events-none opacity-50")}>
            <FileText className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Upload</span>
            <input type="file" accept={BRIEF_FILE_ACCEPT} className="sr-only" aria-label={`Upload a file for brief ${index + 1}`} disabled={reading} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void read(f); }} />
          </label>
          {canRemove && (
            <button type="button" onClick={() => { abort.current?.abort(); onRemove(); }} aria-label={`Remove brief ${index + 1}`} className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground">
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

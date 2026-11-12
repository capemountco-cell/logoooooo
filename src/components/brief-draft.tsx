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

  return (
    <li className="flex flex-col gap-2 rounded-[18px] border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="font-mono text-[11px] tracking-[0.06em] text-muted-foreground uppercase">Brief {index + 1}</span>
        <div className="flex items-center gap-1">
          <label className={cn("inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-border px-2.5 text-xs font-medium text-subtle hover:text-foreground", reading && "pointer-events-none opacity-50")}>
            <FileText className="h-3.5 w-3.5" aria-hidden="true" />
            Upload
            <input type="file" accept={BRIEF_FILE_ACCEPT} className="sr-only" aria-label={`Upload a file for brief ${index + 1}`} disabled={reading} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void read(f); }} />
          </label>
          {canRemove && (
            <button type="button" onClick={() => { abort.current?.abort(); onRemove(); }} aria-label={`Remove brief ${index + 1}`} className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      <div className="relative" {...drop.handlers}>
        <textarea
          aria-label={`Brief ${index + 1}`}
          value={draft.notes}
          onChange={(e) => onChange(e.target.value)}
          onPaste={(e) => {
            const img = Array.from(e.clipboardData.files).find((f) => f.type.startsWith("image/"));
            if (img) { e.preventDefault(); void read(img); }
          }}
          disabled={reading}
          rows={4}
          placeholder="Write, paste or drop in a brief — a screenshot, PDF or text file works too."
          className={cn("min-h-[112px] w-full resize-y rounded-[14px] bg-field px-3.5 py-3 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground focus:bg-field-focus disabled:opacity-60", drop.dragging && "ring-2 ring-blue")}
        />
        {reading && (
          <span className="absolute inset-0 flex items-center justify-center gap-2 rounded-[14px] bg-black/60 text-sm font-medium text-white" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Reading brief…
          </span>
        )}
      </div>
      {(note || error) && <p className={cn("px-1 text-xs", error ? "text-destructive" : "text-success")} role={error ? "alert" : "status"}>{error ?? `${note}. Check it, then generate.`}</p>}
    </li>
  );
}

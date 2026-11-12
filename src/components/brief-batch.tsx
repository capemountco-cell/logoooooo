import { useCallback, useEffect, useState } from "react";
import { loadSaved, removeSaved, saveSoon } from "@/lib/persist";
import { ClipboardList, Download, Files, Plus, Sparkles } from "lucide-react";
import { BriefDraft, type Draft } from "@/components/brief-draft";
import { BRIEF_FILE_ACCEPT } from "@/lib/brief-extract";
import { BriefBatchTask, type BatchBriefFiles } from "@/components/brief-batch-task";
import { Segmented } from "@/components/app/segmented";
import { splitBriefs, type LogoBrief } from "@/lib/brief";
import type { ConceptState } from "@/lib/concept-pipeline";
import { downloadFile, isMobileSaveDevice } from "@/lib/save-png";

type Task = { id: string; notes: string };
type Format = "svg" | "ai" | "png";

const MAX_DRAFTS = 24;
const blank = (): Draft => ({ id: crypto.randomUUID(), notes: "" });

/**
 * Many briefs at once. Briefs wait as cards (add with +, upload several files at once — one card
 * each — or paste a block that splits into cards); Generate starts every filled card, and each
 * then runs on its own.
 */
export function BriefBatch({ onOpen }: { onOpen: (c: ConceptState, brief: LogoBrief) => void }) {
  const [drafts, setDrafts] = useState<Draft[]>(() => [blank()]);
  const [pasting, setPasting] = useState(false);
  const [text, setText] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);
  // Brief cards and started jobs are autosaved on this device (each job saves its own results).
  const [restoring, setRestoring] = useState(true);
  useEffect(() => {
    void Promise.all([loadSaved<{ id: string; notes: string }[]>("batch:drafts"), loadSaved<Task[]>("batch:tasks")]).then(([d, t]) => {
      if (Array.isArray(d) && d.some((x) => x.notes?.trim())) setDrafts(d.map((x) => ({ id: x.id, notes: x.notes })));
      if (Array.isArray(t)) setTasks((cur) => (cur.length ? cur : t));
      setRestoring(false);
    });
  }, []);
  useEffect(() => { if (!restoring) saveSoon("batch:drafts", drafts.map((d) => ({ id: d.id, notes: d.notes }))); }, [drafts, restoring]);
  useEffect(() => { if (!restoring) saveSoon("batch:tasks", tasks); }, [tasks, restoring]);
  const [ready, setReady] = useState<Record<string, BatchBriefFiles>>({});
  const [format, setFormat] = useState<Format>("svg");
  const [saveError, setSaveError] = useState("");
  const pending = splitBriefs(text);
  const filled = drafts.filter((d) => d.notes.trim().length >= 3);
  const room = MAX_DRAFTS - drafts.length;

  /** Adds cards, replacing the single empty starter card if it is still untouched. */
  function addDrafts(next: Draft[]) {
    setDrafts((all) => {
      const base = all.length === 1 && !all[0]!.notes.trim() && !all[0]!.file ? [] : all;
      return [...base, ...next].slice(0, MAX_DRAFTS);
    });
  }
  function splitPasted() {
    if (!pending.length) return;
    addDrafts(pending.map((notes) => ({ id: crypto.randomUUID(), notes })));
    setText("");
    setPasting(false);
  }
  /** Starts every filled card as its own job; empty cards stay for more briefs. */
  function generate() {
    if (!filled.length) return;
    setTasks((t) => [...filled.map((d) => ({ id: crypto.randomUUID(), notes: d.notes.trim() })), ...t]);
    setDrafts([blank()]);
  }
  const markReady = useCallback((id: string, files: BatchBriefFiles | null) => {
    setReady((r) => {
      if (!files) { const { [id]: _gone, ...rest } = r; return rest; }
      return { ...r, [id]: files };
    });
  }, []);
  const readyFiles = tasks.map((t) => ready[t.id]).filter((f): f is BatchBriefFiles => Boolean(f));

  // Started straight from the tap so mobile sharing is allowed.
  function saveAll() {
    setSaveError("");
    const files = readyFiles.map((f) => (format === "svg" ? f.svgFile : format === "ai" ? f.aiFile : f.pngFile));
    if (!files.length) return;
    if (isMobileSaveDevice() && typeof navigator.share === "function" && navigator.canShare?.({ files })) {
      navigator.share({ files }).catch((e: unknown) => {
        if (!(e instanceof Error && e.name === "AbortError")) setSaveError("The share sheet could not open. Save each logo from its card instead.");
      });
      return;
    }
    files.forEach((f, i) => setTimeout(() => downloadFile(f), i * 250));
  }

  return (
    <main className="flex flex-1 flex-col items-center gap-6 px-4 pt-4 pb-16 sm:px-7 sm:pt-8">
      <section aria-label="Briefs to generate" className="flex w-full max-w-[920px] flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-[-0.02em]">Batch</h1>
            <p className="text-[13px] text-muted-foreground">Add a brief per logo. Each gets its own round of checked concepts, made in parallel.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <label className={room <= 0 ? "pointer-events-none opacity-50" : ""}>
              <span className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-full border border-border px-3.5 text-sm font-medium">
                <Files className="h-4 w-4" aria-hidden="true" />
                Upload briefs
              </span>
              <input
                type="file"
                multiple
                accept={BRIEF_FILE_ACCEPT}
                aria-label="Upload several briefs (one card per file)"
                className="sr-only"
                onChange={(e) => { const files = Array.from(e.target.files ?? []).slice(0, Math.max(0, room)); e.target.value = ""; addDrafts(files.map((file) => ({ id: crypto.randomUUID(), notes: "", file }))); }}
              />
            </label>
            <button type="button" onClick={() => setPasting((v) => !v)} aria-expanded={pasting} className="inline-flex h-10 items-center gap-1.5 rounded-full border border-border px-3.5 text-sm font-medium">
              <ClipboardList className="h-4 w-4" aria-hidden="true" />
              Paste several
            </button>
          </div>
        </div>

        {pasting && (
          <div className="flex flex-col gap-2 rounded-[18px] border border-border bg-card p-3">
            <textarea
              aria-label="Several briefs, one per paragraph"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              autoFocus
              placeholder={"One brief per paragraph, or numbered.\n\nEmber — cosy modern coffee shop, warm colours\n\nStill Water yoga studio, calm, minimal, a wave"}
              className="min-h-[130px] w-full resize-y rounded-[14px] bg-field px-3.5 py-3 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground focus:bg-field-focus"
            />
            <button type="button" onClick={splitPasted} disabled={!pending.length} className="inline-flex h-10 items-center justify-center gap-1.5 self-end rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-40">
              Add {pending.length > 1 ? `${pending.length} briefs` : "brief"}
            </button>
          </div>
        )}

        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2" aria-label="Briefs">
          {drafts.map((d, i) => (
            <BriefDraft
              key={d.id}
              draft={d}
              index={i}
              canRemove={drafts.length > 1 || Boolean(d.notes)}
              onChange={(notes) => setDrafts((all) => all.map((x) => (x.id === d.id ? { ...x, notes, file: undefined } : x)))}
              onRemove={() => setDrafts((all) => (all.length > 1 ? all.filter((x) => x.id !== d.id) : [blank()]))}
            />
          ))}
          {room > 0 && (
            <li>
              <button type="button" onClick={() => setDrafts((all) => [...all, blank()])} className="flex h-full min-h-[150px] w-full flex-col items-center justify-center gap-2 rounded-[18px] border-[1.5px] border-dashed border-line text-sm font-medium text-subtle hover:border-line-strong hover:text-foreground">
                <Plus className="h-5 w-5" aria-hidden="true" />
                Add brief
              </button>
            </li>
          )}
        </ul>

        <div className="sticky bottom-3 z-10 flex items-center justify-between gap-3 rounded-full border border-border bg-card/95 py-2 pr-2 pl-5 backdrop-blur">
          <span className="text-[13px] text-muted-foreground">{filled.length ? `${filled.length} brief${filled.length === 1 ? "" : "s"} ready` : "Add at least one brief"}</span>
          <button type="button" onClick={generate} disabled={!filled.length} className="inline-flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-[15px] font-semibold text-primary-foreground disabled:opacity-40">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            Generate {filled.length > 1 ? `${filled.length} logos` : "logo"}
          </button>
        </div>
      </section>

      {tasks.length > 0 && (
        <>
          <div className="flex w-full max-w-[920px] flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">
              {tasks.length} brief{tasks.length === 1 ? "" : "s"} <span className="font-normal text-muted-foreground">· {readyFiles.length} ready</span>
            </h2>
            <div className="flex items-center gap-2">
              <Segmented size="sm" label="Download format" value={format} onChange={setFormat} options={[{ value: "ai", label: ".Ai" }, { value: "svg", label: ".SVG" }, { value: "png", label: ".PNG" }]} className="w-[180px]" />
              <button type="button" onClick={saveAll} disabled={!readyFiles.length} className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-3.5 text-sm font-semibold text-primary-foreground disabled:opacity-40">
                <Download className="h-4 w-4" aria-hidden="true" />
                Download all
              </button>
            </div>
          </div>
          {saveError && <p role="alert" className="text-sm text-destructive">{saveError}</p>}
          <div className="grid w-full max-w-[920px] grid-cols-1 gap-3.5 md:grid-cols-2">
            {tasks.map((t) => (
              <BriefBatchTask
                key={t.id}
                notes={t.notes}
                id={t.id}
                onRemove={() => { setTasks((all) => all.filter((x) => x.id !== t.id)); markReady(t.id, null); void removeSaved(`batch:job:${t.id}`); }}
                onReady={(f) => markReady(t.id, f)}
                onOpen={onOpen}
              />
            ))}
          </div>
        </>
      )}
    </main>
  );
}

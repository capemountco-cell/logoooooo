import { useCallback, useState } from "react";
import { Download, Plus } from "lucide-react";
import { BriefBatchTask, type BatchBriefFiles } from "@/components/brief-batch-task";
import { Segmented } from "@/components/app/segmented";
import { splitBriefs, type LogoBrief } from "@/lib/brief";
import type { ConceptState } from "@/lib/concept-pipeline";
import { downloadFile, isMobileSaveDevice } from "@/lib/save-png";

type Task = { id: string; notes: string };
type Format = "svg" | "ai" | "png";

/** Many briefs at once: paste a dozen, get a logo for each — every brief runs on its own. */
export function BriefBatch({ onOpen }: { onOpen: (c: ConceptState, brief: LogoBrief) => void }) {
  const [text, setText] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [ready, setReady] = useState<Record<string, BatchBriefFiles>>({});
  const [format, setFormat] = useState<Format>("svg");
  const [saveError, setSaveError] = useState("");
  const pending = splitBriefs(text);

  function add() {
    if (!pending.length) return;
    setTasks((t) => [...pending.map((notes) => ({ id: crypto.randomUUID(), notes })), ...t]);
    setText("");
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
      <section aria-label="Add briefs" className="flex w-full max-w-[920px] flex-col gap-3 rounded-[22px] border border-border bg-card p-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_18px_48px_rgba(0,0,0,0.07)]">
        <label className="flex flex-col">
          <span className="sr-only">Briefs, one per paragraph</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            placeholder={"Paste several briefs — one per paragraph, or numbered.\n\nEmber — cosy modern coffee shop, warm colours\n\nStill Water yoga studio, calm, minimal, a wave\n\nHart & Lowe, family law firm, trustworthy, navy"}
            className="min-h-[160px] w-full resize-y rounded-[14px] bg-field px-4 py-3.5 text-base leading-relaxed outline-none placeholder:text-muted-foreground focus:bg-field-focus"
          />
        </label>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-muted-foreground">Each brief gets its own 4 checked concepts, made in parallel.</p>
          <button type="button" onClick={add} disabled={!pending.length} className="inline-flex h-[46px] items-center gap-2 rounded-xl bg-primary px-5 text-[15px] font-semibold text-primary-foreground disabled:opacity-40">
            <Plus className="h-4 w-4" aria-hidden="true" />
            {pending.length > 1 ? `Create ${pending.length} logos` : "Create logo"}
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
              <Segmented size="sm" label="Download format" value={format} onChange={setFormat} options={[{ value: "ai", label: "AI" }, { value: "svg", label: "SVG" }, { value: "png", label: "PNG" }]} className="w-[180px]" />
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
                onRemove={() => { setTasks((all) => all.filter((x) => x.id !== t.id)); markReady(t.id, null); }}
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

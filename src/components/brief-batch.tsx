import { useCallback, useEffect, useRef, useState } from "react";
import { loadSaved, removeSaved, saveSoon } from "@/lib/persist";
import { ClipboardList, Download, Files, Plus, Sparkles } from "lucide-react";
import { Btn, Card, Dot, MOD, PanelHeader, StatusBar, useShortcuts } from "@/components/app/mac";
import { cn } from "@/lib/utils";
import { BriefDraft, type Draft } from "@/components/brief-draft";
import { BRIEF_FILE_ACCEPT } from "@/lib/brief-extract";
import { BriefBatchTask, type BatchBriefFiles, type BatchTaskStatus } from "@/components/brief-batch-task";
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
export function BriefBatch({ onOpen, active = true, onRunning }: { onOpen: (c: ConceptState, brief: LogoBrief) => void; active?: boolean; onRunning?: (count: number) => void }) {
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

  // Each row reports where it belongs (Generating / Ready); the list groups by it.
  const [statuses, setStatuses] = useState<Record<string, BatchTaskStatus>>({});
  const setStatus = useCallback((id: string, st: BatchTaskStatus) => setStatuses((m) => (m[id] === st ? m : { ...m, [id]: st })), []);
  const statusOf = (id: string): BatchTaskStatus => statuses[id] ?? "running";
  const runningCount = tasks.filter((t) => statusOf(t.id) === "running").length;
  const runningRef = useRef(onRunning);
  runningRef.current = onRunning;
  useEffect(() => runningRef.current?.(runningCount), [runningCount]);
  const groups: { id: BatchTaskStatus | "done"; title: string; items: Task[] }[] = [
    { id: "running", title: "Generating", items: tasks.filter((t) => statusOf(t.id) === "running") },
    { id: "done", title: "Ready", items: tasks.filter((t) => statusOf(t.id) !== "running") },
  ];

  useShortcuts([
    { keys: "mod+enter", run: generate },
    { keys: "n", run: () => { if (room > 0) setDrafts((all) => [...all, blank()]); } },
  ], active);

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

  const fmtBtn = (f: Format, label: string) => (
    <button type="button" role="radio" aria-checked={format === f} onClick={() => setFormat(f)} className={cn("h-[22px] rounded-md px-2.5 text-[12px] font-medium", format === f ? "bg-accent text-foreground shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]" : "text-muted-foreground hover:text-foreground")}>{label}</button>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelHeader title="Batch" meta={<span className="text-muted-foreground tabular-nums">{drafts.filter((d) => d.notes.trim()).length + tasks.length} brief{drafts.filter((d) => d.notes.trim()).length + tasks.length === 1 ? "" : "s"}</span>}>
        <Btn onClick={() => setDrafts((all) => [...all, blank()])} disabled={room <= 0} kbd="N" title="Add brief (N)">
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          Add brief
        </Btn>
        <label className={cn("inline-flex h-7 cursor-pointer items-center gap-2 rounded-lg border border-input bg-card px-3 text-[13px] font-medium hover:bg-secondary", room <= 0 && "pointer-events-none opacity-50")}>
          <Files className="h-3.5 w-3.5" aria-hidden="true" />
          Upload briefs
          <input
            type="file"
            multiple
            accept={BRIEF_FILE_ACCEPT}
            aria-label="Upload several briefs (one row per file)"
            className="sr-only"
            onChange={(e) => { const files = Array.from(e.target.files ?? []).slice(0, Math.max(0, room)); e.target.value = ""; addDrafts(files.map((file) => ({ id: crypto.randomUUID(), notes: "", file }))); }}
          />
        </label>
        <Btn onClick={() => setPasting((v) => !v)} aria-expanded={pasting}>
          <ClipboardList className="h-3.5 w-3.5" aria-hidden="true" />
          Paste several
        </Btn>
        <Btn variant="primary" onClick={generate} disabled={!filled.length} kbd={`${MOD}↵`} title={`Generate (${MOD}Enter)`}>
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          Generate {filled.length > 1 ? `${filled.length} logos` : "logo"}
        </Btn>
      </PanelHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-4 pt-2 pb-5 sm:px-5">
        {pasting && (
          <Card title="Paste several briefs" bodyClassName="flex flex-col gap-2 p-3">
            <textarea
              aria-label="Several briefs, one per paragraph"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              autoFocus
              placeholder={"One brief per paragraph, or numbered.\n\nEmber — cosy modern coffee shop, warm colours\n\nStill Water yoga studio, calm, minimal, a wave"}
              className="min-h-[120px] w-full resize-y rounded-lg border border-input bg-field px-3 py-2.5 text-[13px] leading-relaxed outline-none placeholder:text-muted-foreground focus:bg-field-focus"
            />
            <Btn variant="primary" onClick={splitPasted} disabled={!pending.length} className="self-end">
              Add {pending.length > 1 ? `${pending.length} briefs` : "brief"}
            </Btn>
          </Card>
        )}

        <Card title="Waiting" count={drafts.length} aria-label="Briefs to generate" actions={<span className="text-[12px] font-normal text-muted-foreground">{filled.length ? `${filled.length} ready to generate` : "Add at least one brief"}</span>}>
          <ul aria-label="Briefs">
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
          </ul>
          {room > 0 && (
            <button type="button" onClick={() => setDrafts((all) => [...all, blank()])} className="flex h-[34px] w-full items-center gap-2 border-t border-border/50 px-4 text-[13px] text-muted-foreground hover:bg-secondary hover:text-foreground">
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Add brief
            </button>
          )}
        </Card>

        {/* One flat keyed list (headers and rows as siblings), so a row moving from Generating to
            Ready is reordered, never remounted: its job keeps running and keeps its results. */}
        {tasks.length > 0 && (
          <div className="flex flex-col">
            {groups.flatMap((g) => {
              if (!g.items.length) return [];
              return [
                <div key={`head-${g.id}`} className="mt-3.5 flex h-[38px] items-center gap-2 rounded-t-xl border border-border bg-card-head px-4 font-medium text-subtle first:mt-0">
                  {g.title}
                  <span className="text-muted-foreground tabular-nums">{g.items.length}</span>
                  {g.id === "done" && (
                    <>
                      <span className="flex-1" />
                      <div role="radiogroup" aria-label="Download format" className="flex rounded-lg border border-input bg-background p-0.5">
                        {fmtBtn("ai", ".Ai")}{fmtBtn("svg", ".SVG")}{fmtBtn("png", ".PNG")}
                      </div>
                      <Btn variant="ok" onClick={saveAll} disabled={!readyFiles.length} className="h-[26px]">
                        <Download className="h-3.5 w-3.5" aria-hidden="true" />
                        Download all
                      </Btn>
                    </>
                  )}
                </div>,
                ...g.items.map((t, i) => (
                  <div key={t.id} className={cn("border-x border-b border-border bg-card", i === g.items.length - 1 && "rounded-b-xl")}>
                    <BriefBatchTask
                      notes={t.notes}
                      id={t.id}
                      onRemove={() => { setTasks((all) => all.filter((x) => x.id !== t.id)); markReady(t.id, null); void removeSaved(`batch:job:${t.id}`); }}
                      onReady={(f) => markReady(t.id, f)}
                      onStatus={(st) => setStatus(t.id, st)}
                      onOpen={onOpen}
                    />
                  </div>
                )),
              ];
            })}
          </div>
        )}
        {saveError && <p role="alert" className="text-[13px] text-destructive">{saveError}</p>}
      </div>

      <StatusBar>
        {runningCount > 0 ? (
          <span className="inline-flex items-center gap-1.5"><Dot tone="pending" className="h-1.5 w-1.5" />{runningCount} running in parallel</span>
        ) : <span>{tasks.length ? "All done" : "Add briefs, then generate them all at once"}</span>}
        {tasks.length > 0 && <span>{readyFiles.length} of {tasks.length} ready</span>}
        <span className="flex-1" />
        <span>Saved on this device</span>
      </StatusBar>
    </div>
  );
}

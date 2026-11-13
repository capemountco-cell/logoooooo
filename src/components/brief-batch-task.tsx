import { useEffect, useRef, useState } from "react";
import { AlertCircle, Maximize2, RotateCcw, X } from "lucide-react";
import { ConceptTile } from "@/components/app/concept-grid";
import { useBriefJob } from "@/hooks/use-brief-job";
import { logoType, type LogoBrief } from "@/lib/brief";
import type { ConceptState } from "@/lib/concept-pipeline";
import { conceptName, traceConcept } from "@/lib/concept-result";
import { saveLogoSvg } from "@/lib/logo-files";
import { savePng } from "@/lib/save-png";

export type BatchBriefFiles = { svgFile: File; aiFile: File; pngFile: File };

/**
 * One brief in a batch: its own brief cleanup, four checked concepts and prepared files. It
 * starts by itself and never waits on, or touches, any other card.
 */
export function BriefBatchTask({
  id, notes, onRemove, onReady, onOpen,
}: {
  id: string;
  notes: string;
  onRemove: () => void;
  onReady: (files: BatchBriefFiles | null) => void;
  onOpen: (c: ConceptState, brief: LogoBrief) => void;
}) {
  const job = useBriefJob(`batch:job:${id}`);
  const [selected, setSelected] = useState<number | null>(null);
  const [files, setFiles] = useState<BatchBriefFiles | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState("");
  const report = useRef(onReady);
  report.current = onReady;
  async function start() {
    const out = await job.makeBrief(notes, []);
    if (out) await job.generate(out);
  }
  // Starts once saved work has been checked: a card restored after a reload or crash shows its
  // saved results and never starts again by itself. Cleanup cancels, so a remount (React strict
  // mode in development) starts cleanly instead of leaving an aborted request behind.
  useEffect(() => {
    if (!job.ready || job.restored) return;
    void start();
    return job.cancel;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.ready, job.restored]);

  // The first concept to pass is chosen automatically; tapping another switches.
  const passed = job.concepts.filter((c) => c.stage === "passed");
  useEffect(() => {
    if (selected === null && passed[0]) setSelected(passed[0].index);
  }, [passed, selected]);

  // Files are prepared when a concept is chosen, so saving stays a single synchronous tap.
  const chosen = job.concepts.find((c) => c.index === selected && c.stage === "passed");
  useEffect(() => {
    if (!chosen?.image || !job.brief) return;
    let live = true;
    setPreparing(true);
    setFiles(null);
    report.current(null);
    traceConcept(chosen.image, conceptName(job.brief.brandName, chosen.index), chosen.provider)
      .then((t) => {
        if (!live) return;
        const r = t.color ?? t.mono;
        const f = { svgFile: r.board.svgFile, aiFile: r.board.aiFile, pngFile: r.board.pngs.pngFile };
        setFiles(f);
        report.current(f);
      })
      .catch(() => { if (live) setError("This logo couldn't be traced."); })
      .finally(() => { if (live) setPreparing(false); });
    return () => { live = false; };
  }, [chosen?.image, chosen?.index, chosen?.provider, job.brief]);

  useEffect(() => () => report.current(null), []);

  const save = (file: File, png = false) => {
    setError("");
    (png ? savePng(file) : saveLogoSvg(file)).catch((e: unknown) => {
      if (!(e instanceof Error && e.name === "AbortError")) setError(e instanceof Error ? e.message : "Saving failed.");
    });
  };

  const status =
    job.phase === "briefing" ? "Reading brief…"
      : job.phase === "generating" ? `Generating · ${job.concepts.filter((c) => c.stage === "passed" || c.stage === "failed").length} of ${job.concepts.length} checked`
        : job.phase === "done" ? (passed.length ? `${passed.length} passed every check` : "None passed — retry")
          : job.error ? "Failed" : "Waiting";

  return (
    <article className="flex flex-col gap-3 rounded-[18px] border border-border bg-card p-3.5">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold">{job.brief?.brandName || notes.slice(0, 60)}</h3>
          <p className="truncate text-xs text-muted-foreground">
            {job.brief ? `${logoType(job.brief.logoType).label} · ` : ""}
            {status}
          </p>
        </div>
        <button type="button" onClick={() => { job.cancel(); onRemove(); }} aria-label="Remove this brief" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </header>

      {job.concepts.length > 0 ? (
        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${job.concepts.length}, minmax(0, 1fr))` }}>
          {job.concepts.map((c) => (
            <ConceptTile key={c.index} concept={c} checks={job.checks} compact selected={c.index === selected} onPick={() => setSelected(c.index)} />
          ))}
        </div>
      ) : (
        <p className="line-clamp-3 rounded-xl bg-field p-3 text-[13px] text-subtle">{notes}</p>
      )}

      {job.notice && <p className="text-[12px] text-pending" role="status">{job.notice}</p>}

      {(job.error || error) && (
        <p role="alert" className="flex items-center gap-1.5 text-[13px] text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          {job.error || error}
        </p>
      )}

      {chosen && (
        <div className="grid grid-cols-4 gap-1.5">
          <button type="button" disabled={!files} onClick={() => files && save(files.svgFile)} aria-label={`Save SVG for ${job.brief?.brandName ?? "logo"}`} className="h-10 rounded-[10px] bg-primary text-[13px] font-semibold text-primary-foreground disabled:opacity-50">
            {preparing ? "…" : ".SVG"}
          </button>
          <button type="button" disabled={!files} onClick={() => files && save(files.aiFile)} aria-label={`Save Illustrator file for ${job.brief?.brandName ?? "logo"}`} className="h-10 rounded-[10px] border border-border text-[13px] font-medium disabled:opacity-50">.Ai</button>
          <button type="button" disabled={!files} onClick={() => files && save(files.pngFile, true)} aria-label={`Save PNG for ${job.brief?.brandName ?? "logo"}`} className="h-10 rounded-[10px] border border-border text-[13px] font-medium disabled:opacity-50">.PNG</button>
          <button type="button" onClick={() => job.brief && onOpen(chosen, job.brief)} aria-label="Open in the editor" className="inline-flex h-10 items-center justify-center rounded-[10px] border border-border">
            <Maximize2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {(job.phase === "done" && !passed.length) || (job.phase === "idle" && job.error) ? (
        <button type="button" onClick={() => void (job.brief ? job.generate() : start())} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-[10px] border border-border text-[13px] font-medium">
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Retry
        </button>
      ) : null}
    </article>
  );
}

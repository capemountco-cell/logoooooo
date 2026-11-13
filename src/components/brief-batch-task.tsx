import { useEffect, useRef, useState } from "react";
import { AlertCircle, ChevronDown, Loader2, Maximize2, RotateCcw, X } from "lucide-react";
import { ConceptTile } from "@/components/app/concept-grid";
import { Pill } from "@/components/app/mac";
import { useBriefJob } from "@/hooks/use-brief-job";
import { logoType, type LogoBrief } from "@/lib/brief";
import type { ConceptState } from "@/lib/concept-pipeline";
import { conceptName, traceConcept } from "@/lib/concept-result";
import { saveLogoSvg } from "@/lib/logo-files";
import { savePng } from "@/lib/save-png";
import { cn } from "@/lib/utils";

export type BatchBriefFiles = { svgFile: File; aiFile: File; pngFile: File };
/** Where a batch row belongs in the grouped list. */
export type BatchTaskStatus = "running" | "ready" | "failed";

/**
 * One brief in a batch, as a list row: its own brief cleanup, a round of checked concepts and
 * prepared files. It starts by itself and never waits on, or touches, any other row. The row
 * expands to show every concept so another one can be picked.
 */
export function BriefBatchTask({
  id, notes, onRemove, onReady, onOpen, onStatus,
}: {
  id: string;
  notes: string;
  onRemove: () => void;
  onReady: (files: BatchBriefFiles | null) => void;
  onOpen: (c: ConceptState, brief: LogoBrief) => void;
  onStatus: (status: BatchTaskStatus) => void;
}) {
  const job = useBriefJob(`batch:job:${id}`);
  const [selected, setSelected] = useState<number | null>(null);
  const [files, setFiles] = useState<BatchBriefFiles | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const report = useRef(onReady);
  report.current = onReady;
  async function start() {
    const out = await job.makeBrief(notes, []);
    if (out) await job.generate(out);
  }
  // Starts once saved work has been checked: a row restored after a reload or crash shows its
  // saved results and never starts again by itself. Cleanup cancels, so a remount (React strict
  // mode in development) starts cleanly instead of leaving an aborted request behind.
  useEffect(() => {
    if (!job.ready || job.restored) return;
    void start();
    return job.cancel;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.ready, job.restored]);

  // The first concept to pass is chosen automatically; picking another switches.
  const passed = job.concepts.filter((c) => c.stage === "passed");
  useEffect(() => {
    if (selected === null && passed[0]) setSelected(passed[0].index);
  }, [passed, selected]);

  const running = job.phase === "briefing" || job.phase === "generating" || (!job.ready);
  const status: BatchTaskStatus = running ? "running" : passed.length ? "ready" : "failed";
  const statusRef = useRef(onStatus);
  statusRef.current = onStatus;
  useEffect(() => statusRef.current(status), [status]);

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

  const settled = job.concepts.filter((c) => c.stage === "passed" || c.stage === "failed").length;
  const progress = job.phase === "briefing" || !job.ready ? 0.08 : job.concepts.length ? Math.max(0.15, settled / job.concepts.length) : 0.12;
  const statusText =
    !job.ready ? "Restoring…"
      : job.phase === "briefing" ? "Reading brief…"
        : job.phase === "generating" ? (job.refStatus === "searching" ? "Finding references…" : `${settled} of ${job.concepts.length} checked`)
          : passed.length ? `${passed.length} passed`
            : job.error ? "Failed"
              : job.concepts.some((c) => c.note === "Interrupted") ? "Interrupted"
                : "None passed";
  const name = job.brief?.brandName || notes.split(/\n/)[0]!.slice(0, 60);
  const fmt = "h-[26px] rounded-[7px] border border-input bg-card px-2.5 text-[12px] font-medium text-subtle hover:text-foreground disabled:opacity-50";

  return (
    <article aria-label={name} className="flex flex-col">
      <div className="flex min-h-[46px] flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-1.5">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={`${open ? "Hide" : "Show"} concepts for ${name}`} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <span className={cn("grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-md", chosen?.image ? "bg-artboard" : "bg-card-head")}>
            {chosen?.image ? <img src={chosen.image} alt="" className="h-full w-full object-contain" />
              : running ? <Loader2 className="h-3.5 w-3.5 animate-spin text-pending" aria-hidden="true" />
                : <span className="text-[12px] font-bold text-destructive" aria-hidden="true">!</span>}
          </span>
          <span className="min-w-0 truncate font-medium">{name}</span>
          {job.brief && <span className="hidden shrink-0 text-muted-foreground sm:inline">{logoType(job.brief.logoType).label}</span>}
          <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden="true" />
        </button>
        {running && (
          <span className="hidden h-1 w-[140px] overflow-hidden rounded-full bg-accent md:block" aria-hidden="true">
            <span className="block h-full rounded-full bg-pending transition-[width] duration-500" style={{ width: `${progress * 100}%` }} />
          </span>
        )}
        <Pill tone={running ? "pending" : passed.length ? "success" : "destructive"}>{statusText}</Pill>
        {chosen && (
          <span className="flex items-center gap-1.5">
            <button type="button" disabled={!files} onClick={() => files && save(files.aiFile)} aria-label={`Save Illustrator file for ${name}`} className={fmt}>.Ai</button>
            <button type="button" disabled={!files} onClick={() => files && save(files.svgFile)} aria-label={`Save SVG for ${name}`} className={cn(fmt, "text-foreground")}>{preparing ? "…" : ".SVG"}</button>
            <button type="button" disabled={!files} onClick={() => files && save(files.pngFile, true)} aria-label={`Save PNG for ${name}`} className={fmt}>.PNG</button>
            <button type="button" onClick={() => job.brief && onOpen(chosen, job.brief)} aria-label={`Open ${name} in the editor`} title="Open in the editor" className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-[7px] border border-input bg-card text-subtle hover:text-foreground">
              <Maximize2 className="h-3 w-3" aria-hidden="true" />
            </button>
          </span>
        )}
        {status === "failed" && (
          <button type="button" onClick={() => void (job.brief ? job.generate() : start())} className="inline-flex h-[26px] items-center gap-1.5 rounded-[7px] border border-input bg-card px-2.5 text-[12px] font-medium hover:bg-secondary">
            <RotateCcw className="h-3 w-3" aria-hidden="true" />
            Retry
          </button>
        )}
        <button type="button" onClick={() => { job.cancel(); onRemove(); }} aria-label={`Remove ${name}`} className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground">
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      {(job.error || error) && (
        <p role="alert" className="flex items-center gap-1.5 px-4 pb-2 pl-14 text-[12px] text-destructive">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {job.error || error}
        </p>
      )}
      {job.notice && <p className="px-4 pb-2 pl-14 text-[12px] text-pending" role="status">{job.notice}</p>}

      {open && (
        <div className="border-t border-border/50 bg-background/40 px-4 py-3 pl-14">
          {job.concepts.length ? (
            <div className="grid max-w-[520px] gap-2" style={{ gridTemplateColumns: `repeat(${job.concepts.length}, minmax(0, 1fr))` }}>
              {job.concepts.map((c) => (
                <ConceptTile key={c.index} concept={c} checks={job.checks} compact selected={c.index === selected} onSelect={() => setSelected(c.index)} />
              ))}
            </div>
          ) : (
            <p className="line-clamp-3 text-[13px] whitespace-pre-line text-muted-foreground">{notes}</p>
          )}
        </div>
      )}
    </article>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { START_OVER_EVENT } from "@/lib/desktop";
import { loadSaved, saveSoon } from "@/lib/persist";
import { ArrowLeft, Eraser, Images, Pencil, Plus, RotateCcw, Square, Undo2 } from "lucide-react";
import type { JobSnapshot } from "@/lib/persist";
import { BriefComposer } from "@/components/app/brief-composer";
import { BriefCard } from "@/components/app/brief-card";
import { ConceptDetail, ConceptTile } from "@/components/app/concept-grid";
import { ReferenceReview } from "@/components/app/reference-review";
import { Btn, Dot, MOD, PanelHeader, Pill, StatusBar, useShortcuts } from "@/components/app/mac";
import { MAX_CONCEPTS, useBriefJob } from "@/hooks/use-brief-job";
import type { PreparedRef } from "@/lib/concept-client";
import type { ConceptState } from "@/lib/concept-pipeline";
import { logoType, type LogoBrief } from "@/lib/brief";
import { roundSize } from "@/components/app/settings-sheet";

type Sel = { round: string; index: number };
const key = (s: Sel) => `${s.round}:${s.index}`;

/**
 * Concepts first: brief in, a round of checked logo concepts out (3, or 4 with Grok on). "More" stacks a new round on top;
 * earlier rounds stay. The brief can be reviewed before or edited after generating. Laid out like a Mac
 * app: a panel header with the actions, rounds of concept cards beside a detail panel, a status bar.
 */
export function CreateLogo({ onOpen, active = true }: { onOpen: (c: ConceptState, brief: LogoBrief) => void; active?: boolean }) {
  const job = useBriefJob("create:job");
  const [notes, setNotes] = useState("");
  // The brief text is autosaved on this device too, so a crash never loses what was typed.
  const [notesReady, setNotesReady] = useState(false);
  useEffect(() => {
    void loadSaved<string>("create:notes").then((saved) => {
      if (typeof saved === "string") setNotes((n) => n || saved);
      setNotesReady(true);
    });
  }, []);
  useEffect(() => { if (notesReady) saveSoon("create:notes", notes); }, [notes, notesReady]);
  const [refs, setRefs] = useState<PreparedRef[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const [sel, setSel] = useState<Sel | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set());

  // Start over: one tap clears the brief text, references, the brief and every round (and the
  // autosaved copy, which saves the empty state). Undo stays available for a few seconds.
  const [undo, setUndo] = useState<{ snap: JobSnapshot; notes: string; refs: PreparedRef[] } | null>(null);
  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 10_000);
    return () => clearTimeout(t);
  }, [undo]);
  const canStartOver = Boolean(notes.trim() || refs.length || job.brief || job.rounds.length);
  function startOver() {
    if (!canStartOver) return;
    setUndo({ snap: job.snapshot(), notes, refs });
    job.reset();
    setNotes("");
    setRefs([]);
    setSel(null);
    setRevealed(new Set());
    setReviewing(false);
  }
  function undoStartOver() {
    if (!undo) return;
    job.restore(undo.snap);
    setNotes(undo.notes);
    setRefs(undo.refs);
    setUndo(null);
  }
  // The Mac app's menu (File → Start Over, ⌘⇧⌫) runs the same thing.
  const startOverRef = useRef(startOver);
  startOverRef.current = startOver;
  useEffect(() => {
    const run = () => startOverRef.current();
    window.addEventListener(START_OVER_EVENT, run);
    return () => window.removeEventListener(START_OVER_EVENT, run);
  }, []);
  const startOverBtn = (
    <Btn variant="ghost" onClick={startOver} disabled={!canStartOver} title="Start over: clear the brief, references and all concepts">
      <Eraser className="h-3.5 w-3.5" aria-hidden="true" />
      Start over
    </Btn>
  );
  const undoBar = undo ? (
    <div role="status" className="mx-4 mt-1 flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-[13px] sm:mx-6">
      <span className="text-subtle">Cleared — brief, references and concepts.</span>
      <span className="flex-1" />
      <Btn onClick={undoStartOver}>
        <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
        Undo
      </Btn>
    </div>
  ) : null;
  const studio = job.rounds.length > 0 && (job.phase === "generating" || job.phase === "done");
  const all = job.rounds.flatMap((r) => r.concepts);
  const passed = all.filter((c) => c.stage === "passed").length;
  const running = job.phase === "generating";
  const current = job.rounds[0];
  const settledNow = current ? current.concepts.filter((c) => c.stage === "passed" || c.stage === "failed").length : 0;

  // Every concept in display order (newest round first), with its running number.
  const flat = useMemo(() => {
    const out: { sel: Sel; concept: ConceptState; label: string }[] = [];
    job.rounds.forEach((r, i) => {
      const offset = job.rounds.slice(i + 1).reduce((t, x) => t + x.concepts.length, 0);
      for (const c of r.concepts) out.push({ sel: { round: r.id, index: c.index }, concept: c, label: `Concept ${offset + c.index + 1}` });
    });
    return out;
  }, [job.rounds]);
  const selected = flat.find((f) => sel && key(f.sel) === key(sel)) ?? null;
  const selectedRound = job.rounds.find((r) => r.id === selected?.sel.round);

  // Select the first concept to pass in the newest round once there is one.
  useEffect(() => {
    if (selected) return;
    const first = flat.find((f) => f.sel.round === current?.id && f.concept.stage === "passed");
    if (first) setSel(first.sel);
  }, [flat, selected, current?.id]);

  async function generateFromNotes() {
    const out = await job.makeBrief(notes, refs);
    if (out) await job.generate(out);
  }
  const usable = (f: (typeof flat)[number] | null) => Boolean(f && (f.concept.stage === "passed" || (f.concept.stage === "failed" && revealed.has(key(f.sel)) && f.concept.image)));
  const openSelected = () => { if (selected && usable(selected) && job.brief) onOpen(selected.concept, job.brief); };
  const move = (step: number) => {
    if (!flat.length) return;
    const i = selected ? flat.indexOf(selected) : -1;
    setSel(flat[(i + step + flat.length) % flat.length]!.sel);
  };

  useShortcuts(
    studio
      ? [
          { keys: "mod+enter", run: () => { if (!running) void job.generate(); } },
          { keys: "enter", run: openSelected },
          { keys: "arrowright", run: () => move(1) },
          { keys: "arrowleft", run: () => move(-1) },
          { keys: "e", run: () => { job.cancel(); job.setPhase("brief"); } },
          { keys: "a", run: () => void job.addConcept() },
          { keys: "n", run: () => { job.cancel(); job.setPhase("idle"); } },
          { keys: "r", run: () => setReviewing(true) },
          { keys: "escape", run: () => { if (running) job.cancel(); } },
        ]
      : [],
    active && !reviewing,
  );

  if (studio && job.brief) {
    const b = job.brief;
    const statusText =
      running && job.refStatus === "searching" ? "Finding reference logos for style, concept and lettering…"
        : running && current && !current.plans ? "Planning a different idea for each concept…"
        : running ? `Drawing round ${job.rounds.length} · ${settledNow} of ${current?.concepts.length ?? roundSize()} checked`
          : job.extraRunning ? `Drawing ${job.extraRunning} concept${job.extraRunning === 1 ? "" : "s"}…`
          : passed ? `${passed} concept${passed === 1 ? "" : "s"} passed every check`
            : "No concept passed every check — try more, or adjust the brief";
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <PanelHeader
          title={b.brandName || "Untitled"}
          meta={
            <>
              <Pill>{logoType(b.logoType).label}</Pill>
              {b.personality.length > 0 && <span className="hidden truncate text-muted-foreground md:inline">{b.personality.join(" · ")}</span>}
            </>
          }
        >
          {startOverBtn}
          <Btn onClick={() => setReviewing(true)} kbd="R" title="Review references (R)">
            <Images className="h-3.5 w-3.5" aria-hidden="true" />
            References{job.refs.length ? ` (${job.refs.length})` : ""}
          </Btn>
          <Btn onClick={() => void job.addConcept()} disabled={!current?.checks.length || (current?.concepts.length ?? 0) >= MAX_CONCEPTS} kbd="A" title="Add one more concept with a new idea (A)">
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Add concept
          </Btn>
          <Btn onClick={() => { job.cancel(); job.setPhase("brief"); }} kbd="E" title="Edit brief (E)">
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            Edit brief
          </Btn>
          <Btn onClick={() => { job.cancel(); job.setPhase("idle"); }} kbd="N" title="New brief (N)">
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            New brief
          </Btn>
          {running ? (
            <Btn onClick={job.cancel} kbd="esc" title="Stop (Esc)">
              <Square className="h-3 w-3" aria-hidden="true" />
              Stop
            </Btn>
          ) : (
            <Btn variant="primary" onClick={() => void job.generate()} kbd={`${MOD}↵`} title={`More concepts (${MOD}Enter)`}>
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              {roundSize()} more concepts
            </Btn>
          )}
        </PanelHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
          <section aria-label="Concept rounds" className="flex min-w-0 flex-none flex-col gap-3.5 px-4 pt-2 pb-5 sm:px-5 lg:flex-1 lg:overflow-y-auto">
            {job.notice && <p className="rounded-lg border border-warn-border bg-warn-bg px-3 py-2 text-[13px] text-warn" role="status">{job.notice}</p>}
            {job.rounds.map((round, i) => {
              const n = job.rounds.length - i;
              const ok = round.concepts.filter((c) => c.stage === "passed").length;
              const settled = round.concepts.every((c) => c.stage === "passed" || c.stage === "failed");
              return (
                <section key={round.id} aria-label={`Round ${n}`} className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2 font-medium text-subtle">
                    Round {n}
                    <span className="font-normal text-muted-foreground">{round.concepts.length} concepts</span>
                    <span className="flex-1" />
                    {round.refs.length > 0 && (
                      <button type="button" onClick={() => setReviewing(true)} className="inline-flex h-6 items-center gap-1.5 rounded-full border border-input bg-background pr-2.5 pl-1 text-[12px] font-normal text-subtle hover:text-foreground" aria-label={`Review the ${round.refs.length} references used in round ${n}`}>
                        <span className="flex -space-x-1.5">
                          {round.refs.slice(0, 3).map((r) => <img key={r.id} src={r.image} alt="" className="h-4 w-4 rounded-full border border-background bg-artboard object-cover" />)}
                        </span>
                        {round.refs.length} reference{round.refs.length === 1 ? "" : "s"}
                      </button>
                    )}
                    {settled && (ok ? <Pill tone="success" className="border-transparent bg-success/15 font-semibold text-success">{ok} passed every check</Pill> : <Pill tone="destructive">None passed</Pill>)}
                  </div>
                  <div className={`grid grid-cols-2 gap-3 ${round.concepts.length === 3 ? "md:grid-cols-3" : "md:grid-cols-4"}`}>
                    {round.concepts.map((c) => {
                      const s = { round: round.id, index: c.index };
                      const f = flat.find((x) => key(x.sel) === key(s));
                      return (
                        <ConceptTile
                          key={c.index}
                          concept={c}
                          checks={round.checks}
                          label={f?.label}
                          title={round.plans?.[c.index]?.name}
                          selected={sel !== null && key(sel) === key(s)}
                          revealed={revealed.has(key(s))}
                          onReveal={() => { setRevealed((r) => new Set(r).add(key(s))); setSel(s); }}
                          onSelect={() => setSel(s)}
                          onPick={() => onOpen(c, b)}
                        />
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </section>

          <aside aria-label="Concept details" className="flex flex-none flex-col gap-3.5 border-t border-border px-4 pt-3 pb-4 lg:w-[320px] lg:overflow-y-auto lg:border-t-0 lg:border-l">
            <ConceptDetail
              concept={selected?.concept ?? null}
              checks={selectedRound?.checks ?? []}
              label={selected?.label ?? ""}
              colors={b.colors}
              revealed={selected ? revealed.has(key(selected.sel)) : false}
              plan={selectedRound?.plans?.[selected?.concept.index ?? -1]}
              onRedraw={selected ? () => job.redraw(selected.sel.round, selected.sel.index) : undefined}
              onRecreate={selected ? (change) => job.recreate(selected.sel.round, selected.sel.index, change) : undefined}
              onOpen={openSelected}
            />
          </aside>
        </div>

        <StatusBar>
          <span className="inline-flex items-center gap-1.5">
            <Dot tone={running ? "pending" : passed ? "success" : "destructive"} className="h-1.5 w-1.5" />
            <span role="status">{statusText}</span>
          </span>
          {job.refs.length > 0 && <span className="hidden sm:inline">{job.refs.length} reference{job.refs.length === 1 ? "" : "s"}{job.provider ? ` (${job.provider === "brave" ? "Brave" : "Openverse"})` : ""}</span>}
          <span className="flex-1" />
          <span className="hidden sm:inline">← → to browse · ↵ to export</span>
          <span>Saved on this device</span>
        </StatusBar>

        <ReferenceReview
          open={reviewing}
          onOpenChange={setReviewing}
          refs={job.refs}
          candidates={job.candidates}
          provider={job.provider}
          status={job.refStatus}
          onRemove={job.removeRef}
          onRole={job.changeRole}
          onCandidate={job.useCandidate}
          onUpload={job.addUpload}
          onLink={job.addLink}
          onFindNew={job.findNewRefs}
          onGenerate={() => void job.generate()}
          busy={running}
        />
      </div>
    );
  }

  if (job.phase === "brief" && job.brief) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <PanelHeader title="Review brief" meta={<span className="hidden text-muted-foreground sm:inline">Cleaned up from your notes — fix anything before generating</span>}>
          {startOverBtn}
          <Btn variant="ghost" onClick={() => job.setPhase(job.rounds.length ? "done" : "idle")}>
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            {job.rounds.length ? "Back to concepts" : "Edit notes"}
          </Btn>
        </PanelHeader>
        <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-4 pt-3 pb-8">
          <BriefCard
            brief={job.brief}
            references={job.references}
            onChange={job.setBrief}
            onGenerate={() => void job.generate()}
            onBack={() => job.setPhase(job.rounds.length ? "done" : "idle")}
            backLabel={job.rounds.length ? "Back to concepts" : "Edit notes"}
          />
        </div>
        <StatusBar>
          <span>Brand name and tagline are used exactly as written</span>
          <span className="flex-1" />
          <span>Saved on this device</span>
        </StatusBar>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelHeader title="New brief" meta={<span className="hidden text-muted-foreground sm:inline">Write it, paste a page, or drop a screenshot or PDF</span>}>
        {startOverBtn}
      </PanelHeader>
      {undoBar}
      <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-4 pt-4 pb-8 sm:pt-8">
        <BriefComposer
          notes={notes}
          onNotes={setNotes}
          refs={refs}
          onRefs={setRefs}
          busy={job.phase === "briefing"}
          onGenerate={() => void generateFromNotes()}
          onReview={() => void job.makeBrief(notes, refs)}
          onCancel={job.cancel}
          error={job.error}
        />
      </div>
      <StatusBar>
        <span>{job.phase === "briefing" ? "Reading your brief…" : "Links are opened as references · menus and footers are cleaned out"}</span>
        <span className="flex-1" />
        <span>Saved on this device</span>
      </StatusBar>
    </div>
  );
}

import { useEffect, useState } from "react";
import { loadSaved, saveSoon } from "@/lib/persist";
import { Images, Pencil, Plus, RotateCcw, Square } from "lucide-react";
import { BriefComposer } from "@/components/app/brief-composer";
import { BriefCard } from "@/components/app/brief-card";
import { ConceptGrid } from "@/components/app/concept-grid";
import { ReferenceReview } from "@/components/app/reference-review";
import { useBriefJob } from "@/hooks/use-brief-job";
import type { PreparedRef } from "@/lib/concept-client";
import type { ConceptState } from "@/lib/concept-pipeline";
import { logoType, type LogoBrief } from "@/lib/brief";
import { roundSize } from "@/components/app/settings-sheet";

/**
 * Concepts first: brief in, a round of checked logo concepts out (3, or 4 with Grok on). "More" stacks a new round on top;
 * earlier rounds stay. The brief can be reviewed before or edited after generating.
 */
export function CreateLogo({ onOpen }: { onOpen: (c: ConceptState, brief: LogoBrief) => void }) {
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
  const studio = job.rounds.length > 0 && (job.phase === "generating" || job.phase === "done");
  const all = job.rounds.flatMap((r) => r.concepts);
  const passed = all.filter((c) => c.stage === "passed").length;
  const running = job.phase === "generating";
  const current = job.rounds[0];
  const settledNow = current ? current.concepts.filter((c) => c.stage === "passed" || c.stage === "failed").length : 0;

  async function generateFromNotes() {
    const out = await job.makeBrief(notes, refs);
    if (out) await job.generate(out);
  }

  if (studio && job.brief) {
    const b = job.brief;
    return (
      <main className="flex flex-1 flex-col items-center px-4 pt-2 pb-20 sm:px-7">
        <div className="flex w-full max-w-[1180px] flex-col gap-8">
          <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
            <div className="flex min-w-0 flex-col gap-1.5">
              <h1 className="truncate text-[28px] font-semibold tracking-[-0.025em] sm:text-[34px]">{b.brandName || "Untitled"}</h1>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
                <span className="rounded-full border border-border px-2.5 py-0.5 text-foreground">{logoType(b.logoType).label}</span>
                {b.personality.length > 0 && <span>{b.personality.join(" · ")}</span>}
                {b.colors.length > 0 && <span>· {b.colors.join(", ")}</span>}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setReviewing(true)} className="inline-flex h-10 items-center gap-1.5 rounded-full border border-border px-3.5 text-sm font-medium">
                <Images className="h-4 w-4" aria-hidden="true" />
                References{job.refs.length ? ` (${job.refs.length})` : ""}
              </button>
              <button type="button" onClick={() => { job.cancel(); job.setPhase("brief"); }} className="inline-flex h-10 items-center gap-1.5 rounded-full border border-border px-3.5 text-sm font-medium">
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                Edit brief
              </button>
              <button type="button" onClick={() => { job.cancel(); job.setPhase("idle"); }} className="inline-flex h-10 items-center gap-1.5 rounded-full border border-border px-3.5 text-sm font-medium">
                <Plus className="h-4 w-4" aria-hidden="true" />
                New brief
              </button>
              {running ? (
                <button type="button" onClick={job.cancel} className="inline-flex h-10 items-center gap-1.5 rounded-full border border-border px-3.5 text-sm font-medium">
                  <Square className="h-3.5 w-3.5" aria-hidden="true" />
                  Stop
                </button>
              ) : (
                <button type="button" onClick={() => void job.generate()} className="inline-flex h-10 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground">
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  {roundSize()} more concepts
                </button>
              )}
            </div>
          </header>

          <p className="-mt-3 text-[13px] text-muted-foreground" role="status">
            {running && job.refStatus === "searching"
              ? "Finding reference logos for style, concept and lettering…"
              : running
              ? `Drawing and checking round ${job.rounds.length} · ${settledNow} of ${current?.concepts.length ?? roundSize()} done. Concepts appear only once they pass every check.`
              : passed
                ? `${passed} concept${passed === 1 ? "" : "s"} passed every check. Pick one to trace and export it.`
                : "No concept passed every check this time. Try more, or adjust the brief."}
          </p>

          {job.notice && <p className="-mt-5 text-[13px] text-pending" role="status">{job.notice}</p>}

          {job.rounds.map((round, i) => {
            const n = job.rounds.length - i;
            const ok = round.concepts.filter((c) => c.stage === "passed").length;
            return (
              <section key={round.id} aria-label={`Round ${n}`} className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  {job.rounds.length > 1 ? (
                    <h2 className="font-mono text-[11px] tracking-[0.06em] text-muted-foreground uppercase">
                      Round {n} · {ok} of {round.concepts.length} passed
                    </h2>
                  ) : <span />}
                  {round.refs.length > 0 && (
                    <button type="button" onClick={() => setReviewing(true)} className="group inline-flex items-center gap-2 rounded-full border border-border py-1 pr-3 pl-1 text-xs text-muted-foreground hover:text-foreground" aria-label={`Review the ${round.refs.length} references used in round ${n}`}>
                      <span className="flex -space-x-2">
                        {round.refs.slice(0, 4).map((r) => (
                          <img key={r.id} src={r.image} alt="" className="h-7 w-7 rounded-full border-2 border-background bg-artboard object-cover" />
                        ))}
                      </span>
                      {round.refs.length} reference{round.refs.length === 1 ? "" : "s"} used
                    </button>
                  )}
                </div>
                <ConceptGrid concepts={round.concepts} checks={round.checks} offset={job.rounds.slice(i + 1).reduce((t, r) => t + r.concepts.length, 0)} onPick={(c) => onOpen(c, b)} />
              </section>
            );
          })}
        </div>
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
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col items-center gap-8 px-4 pt-6 pb-20 sm:gap-10 sm:pt-14">
      {job.phase === "brief" && job.brief ? (
        <BriefCard
          brief={job.brief}
          references={job.references}
          onChange={job.setBrief}
          onGenerate={() => void job.generate()}
          onBack={() => job.setPhase(job.rounds.length ? "done" : "idle")}
          backLabel={job.rounds.length ? "Back to concepts" : "Edit notes"}
        />
      ) : (
        <>
          <div className="flex max-w-[760px] flex-col gap-3 sm:items-center sm:text-center">
            <h1 className="text-balance text-[34px] font-semibold leading-[1.05] tracking-[-0.035em] sm:text-[56px]">Logo concepts from a brief.</h1>
            <p className="text-[15px] text-muted-foreground sm:text-base">Rounds of concepts, each checked and fixed before you see it. Export as SVG, AI or PNG.</p>
          </div>
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
        </>
      )}
    </main>
  );
}

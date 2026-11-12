import { useState } from "react";
import { Pencil, Plus, RotateCcw, Square } from "lucide-react";
import { BriefComposer } from "@/components/app/brief-composer";
import { BriefCard } from "@/components/app/brief-card";
import { ConceptGrid } from "@/components/app/concept-grid";
import { useBriefJob } from "@/hooks/use-brief-job";
import type { PreparedRef } from "@/lib/concept-client";
import type { ConceptState } from "@/lib/concept-pipeline";
import { logoType, type LogoBrief } from "@/lib/brief";

/**
 * Concepts first: brief in, four checked logo concepts out. "4 more" stacks a new round on top;
 * earlier rounds stay. The brief can be reviewed before or edited after generating.
 */
export function CreateLogo({ onOpen }: { onOpen: (c: ConceptState, brief: LogoBrief) => void }) {
  const job = useBriefJob();
  const [notes, setNotes] = useState("");
  const [refs, setRefs] = useState<PreparedRef[]>([]);
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
                  4 more concepts
                </button>
              )}
            </div>
          </header>

          <p className="-mt-3 text-[13px] text-muted-foreground" role="status">
            {running
              ? `Drawing and checking round ${job.rounds.length} · ${settledNow} of 4 done. Concepts appear only once they pass every check.`
              : passed
                ? `${passed} concept${passed === 1 ? "" : "s"} passed every check. Pick one to trace and export it.`
                : "No concept passed every check this time. Try 4 more, or adjust the brief."}
          </p>

          {job.rounds.map((round, i) => {
            const n = job.rounds.length - i;
            const ok = round.concepts.filter((c) => c.stage === "passed").length;
            return (
              <section key={round.id} aria-label={`Round ${n}`} className="flex flex-col gap-4">
                {job.rounds.length > 1 && (
                  <h2 className="font-mono text-[11px] tracking-[0.06em] text-muted-foreground uppercase">
                    Round {n} · {ok} of 4 passed
                  </h2>
                )}
                <ConceptGrid concepts={round.concepts} checks={round.checks} offset={(n - 1) * 4} onPick={(c) => onOpen(c, b)} />
              </section>
            );
          })}
        </div>
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
            <p className="text-[15px] text-muted-foreground sm:text-base">Four concepts per round, each checked and fixed before you see it. Export as SVG, AI or PNG.</p>
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

import { useState } from "react";
import { ArrowLeft, RotateCcw, Square } from "lucide-react";
import { BriefComposer } from "@/components/app/brief-composer";
import { BriefCard } from "@/components/app/brief-card";
import { ConceptGrid } from "@/components/app/concept-grid";
import { useBriefJob } from "@/hooks/use-brief-job";
import type { PreparedRef } from "@/lib/concept-client";
import type { ConceptState } from "@/lib/concept-pipeline";
import type { LogoBrief } from "@/lib/brief";

/** Brief → editable brief card → four checked concepts. Picking one opens it in the workspace. */
export function CreateLogo({ onOpen }: { onOpen: (c: ConceptState, brief: LogoBrief) => void }) {
  const job = useBriefJob();
  const [notes, setNotes] = useState("");
  const [refs, setRefs] = useState<PreparedRef[]>([]);
  const showConcepts = job.phase === "generating" || job.phase === "done";
  const passed = job.concepts.filter((c) => c.stage === "passed").length;
  const finished = job.concepts.filter((c) => c.stage === "passed" || c.stage === "failed").length;

  return (
    <main className="flex flex-1 flex-col items-center gap-7 px-4 pt-4 pb-16 sm:gap-9 sm:px-5 sm:pt-10">
      {!showConcepts && (
        <h1 className="max-w-[720px] text-balance text-[32px] font-semibold leading-[1.1] tracking-[-0.03em] text-[#8A8A86] sm:text-center sm:text-[48px] sm:leading-[1.08] sm:tracking-[-0.035em]">
          Describe it. Get a <span className="text-foreground">logo that's ready to use.</span>
        </h1>
      )}

      {(job.phase === "idle" || job.phase === "briefing") && (
        <BriefComposer
          notes={notes}
          onNotes={setNotes}
          refs={refs}
          onRefs={setRefs}
          busy={job.phase === "briefing"}
          onSubmit={() => void job.makeBrief(notes, refs)}
          onCancel={job.cancel}
          error={job.error}
        />
      )}

      {job.phase === "brief" && job.brief && (
        <BriefCard brief={job.brief} references={job.references} onChange={job.setBrief} onGenerate={() => void job.generate()} onBack={() => job.setPhase("idle")} />
      )}

      {showConcepts && job.brief && (
        <>
          <div className="flex w-full max-w-[920px] flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-[-0.02em]">{job.brief.brandName || "Your logo"}</h1>
              <p className="text-[13px] text-muted-foreground">
                {job.phase === "done"
                  ? passed
                    ? `${passed} of 4 concepts passed every check.${passed < 4 ? " The rest didn't, so they aren't shown." : ""}`
                    : "No concept passed every check this time. Try again, or adjust the brief."
                  : `Every concept is checked and fixed before you see it · ${finished} of 4 done`}
              </p>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => { job.cancel(); job.setPhase("brief"); }} className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-sm font-medium">
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Brief
              </button>
              {job.phase === "generating" ? (
                <button type="button" onClick={job.cancel} className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-sm font-medium">
                  <Square className="h-3.5 w-3.5" aria-hidden="true" />
                  Stop
                </button>
              ) : (
                <button type="button" onClick={() => void job.generate()} className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-sm font-semibold text-primary-foreground">
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  4 more
                </button>
              )}
            </div>
          </div>
          <ConceptGrid concepts={job.concepts} checks={job.checks} onPick={(c) => job.brief && onOpen(c, job.brief)} />
        </>
      )}
    </main>
  );
}

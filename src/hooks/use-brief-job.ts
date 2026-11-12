import { useCallback, useEffect, useRef, useState } from "react";
import type { LogoBrief, ReferenceNote } from "@/lib/brief";
import { cleanBrief, conceptDeps, type PreparedRef } from "@/lib/concept-client";
import { checklist, CONCEPT_PROVIDERS, type CheckDef } from "@/lib/concept-prompt";
import { runConcept, type ConceptState } from "@/lib/concept-pipeline";

export type JobPhase = "idle" | "briefing" | "brief" | "generating" | "done";

const queued = (): ConceptState[] =>
  CONCEPT_PROVIDERS.map((provider, index) => ({ provider, index, stage: "queued", image: null, results: [], fixes: 0, redraws: 0, note: "" }));

/**
 * One brief → four checked concepts. Each job (the single page, every batch card) owns its own
 * inputs, abort controller and results, so jobs never block or overwrite each other.
 */
export function useBriefJob() {
  const [phase, setPhase] = useState<JobPhase>("idle");
  const [brief, setBrief] = useState<LogoBrief | null>(null);
  const [references, setReferences] = useState<ReferenceNote[]>([]);
  const [signatures, setSignatures] = useState<Float32Array[]>([]);
  const [concepts, setConcepts] = useState<ConceptState[]>([]);
  const [checks, setChecks] = useState<CheckDef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const fresh = () => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    return abort;
  };

  /** Notes + references → brief. Returns it so callers (batch) can go straight on. */
  const makeBrief = useCallback(async (notes: string, refs: PreparedRef[]) => {
    const abort = fresh();
    setPhase("briefing");
    setError(null);
    try {
      const out = await cleanBrief(notes, refs, abort.signal);
      if (abort.signal.aborted) return null;
      setBrief(out.brief);
      setReferences(out.references);
      setSignatures(refs.map((r) => r.signature));
      setPhase("brief");
      return { ...out, signatures: refs.map((r) => r.signature) };
    } catch (e) {
      if (abort.signal.aborted) return null;
      setError(e instanceof Error ? e.message.replace(/^\d{3}\s/, "") : "Couldn't read your brief.");
      setPhase("idle");
      return null;
    }
  }, []);

  /** Runs the four concepts, each through the check-and-fix loop, all in parallel. */
  const generate = useCallback(async (input?: { brief: LogoBrief; references: ReferenceNote[]; signatures: Float32Array[] }) => {
    const job = input ?? (brief ? { brief, references, signatures } : null);
    if (!job) return;
    const abort = fresh();
    const list = checklist(job.brief, job.references.length > 0);
    const deps = conceptDeps(job, list);
    setChecks(list);
    setConcepts(queued());
    setPhase("generating");
    setError(null);
    await Promise.all(
      CONCEPT_PROVIDERS.map((provider, index) =>
        runConcept({ provider, index, checks: list }, deps, abort.signal, (s) => {
          if (!abort.signal.aborted) setConcepts((all) => all.map((c) => (c.index === index ? s : c)));
        }).catch(() => undefined),
      ),
    );
    if (!abort.signal.aborted) setPhase("done");
  }, [brief, references, signatures]);

  const cancel = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    setPhase((p) => (p === "briefing" ? "idle" : p === "generating" ? "brief" : p));
  }, []);

  const reset = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    setPhase("idle");
    setBrief(null);
    setConcepts([]);
    setError(null);
  }, []);

  return { phase, brief, setBrief, references, concepts, checks, error, makeBrief, generate, cancel, reset, setPhase };
}

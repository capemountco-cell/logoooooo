import { useCallback, useEffect, useRef, useState } from "react";
import type { LogoBrief, ReferenceNote } from "@/lib/brief";
import { cleanBrief, conceptDeps, type PreparedRef } from "@/lib/concept-client";
import { checklist, CONCEPT_PROVIDERS, type CheckDef } from "@/lib/concept-prompt";
import { runConcept, type ConceptState } from "@/lib/concept-pipeline";

export type JobPhase = "idle" | "briefing" | "brief" | "generating" | "done";

/** One press of Generate: four concepts and the checklist they were held to. */
export type Round = { id: string; concepts: ConceptState[]; checks: CheckDef[] };

const queued = (): ConceptState[] =>
  CONCEPT_PROVIDERS.map((provider, index) => ({ provider, index, stage: "queued", image: null, results: [], fixes: 0, redraws: 0, note: "" }));

const settled = (c: ConceptState) => c.stage === "passed" || c.stage === "failed";

/**
 * One brief → rounds of four checked concepts. Each job (the Create page, every batch card) owns
 * its own inputs, abort controller and results, so jobs never block or overwrite each other.
 * Every Generate adds a round on top; earlier rounds stay so good concepts are never lost.
 */
export function useBriefJob() {
  const [phase, setPhase] = useState<JobPhase>("idle");
  const [brief, setBrief] = useState<LogoBrief | null>(null);
  const [references, setReferences] = useState<ReferenceNote[]>([]);
  const [signatures, setSignatures] = useState<Float32Array[]>([]);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  /** Concepts cut off by Stop or a new round are marked stopped, never left spinning. */
  const stopUnfinished = () =>
    setRounds((all) => all.map((r) => ({ ...r, concepts: r.concepts.map((c) => (settled(c) ? c : { ...c, stage: "failed", note: "Stopped" })) })));

  const fresh = () => {
    if (controller.current) stopUnfinished();
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    return abort;
  };

  /** Notes + references → brief. Returns it so callers can go straight on to generating. */
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
      setRounds([]);
      setPhase("brief");
      return { ...out, signatures: refs.map((r) => r.signature) };
    } catch (e) {
      if (abort.signal.aborted) return null;
      setError(e instanceof Error ? e.message.replace(/^\d{3}\s/, "") : "Couldn't read your brief.");
      setPhase("idle");
      return null;
    }
  }, []);

  /** Runs four concepts, each through the check-and-fix loop, all in parallel, as a new round. */
  const generate = useCallback(async (input?: { brief: LogoBrief; references: ReferenceNote[]; signatures: Float32Array[] }) => {
    const job = input ?? (brief ? { brief, references, signatures } : null);
    if (!job) return;
    const abort = fresh();
    const checks = checklist(job.brief, job.references.length > 0);
    const deps = conceptDeps(job, checks);
    const id = crypto.randomUUID();
    setRounds((all) => [{ id, concepts: queued(), checks }, ...all]);
    setPhase("generating");
    setError(null);
    await Promise.all(
      CONCEPT_PROVIDERS.map((provider, index) =>
        runConcept({ provider, index, checks }, deps, abort.signal, (s) => {
          if (abort.signal.aborted) return;
          setRounds((all) => all.map((r) => (r.id === id ? { ...r, concepts: r.concepts.map((c) => (c.index === index ? s : c)) } : r)));
        }).catch(() => undefined),
      ),
    );
    if (!abort.signal.aborted) {
      controller.current = null;
      setPhase("done");
    }
  }, [brief, references, signatures]);

  const cancel = useCallback(() => {
    if (controller.current) stopUnfinished();
    controller.current?.abort();
    controller.current = null;
    setPhase((p) => (p === "briefing" ? "idle" : p === "generating" ? "done" : p));
  }, []);

  const latest = rounds[0];
  return {
    phase, setPhase, brief, setBrief, references, rounds, error, makeBrief, generate, cancel,
    /** The newest round (what batch cards show). */
    concepts: latest?.concepts ?? [],
    checks: latest?.checks ?? [],
  };
}

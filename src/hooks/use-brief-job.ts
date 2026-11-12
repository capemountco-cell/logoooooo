import { useCallback, useEffect, useRef, useState } from "react";
import type { LogoBrief, ReferenceNote, ReferenceRole } from "@/lib/brief";
import { cleanBrief, conceptDeps, describeRef, findAutoRefs, type PreparedRef, type RefItem } from "@/lib/concept-client";
import { checklist, CONCEPT_PROVIDERS, requiredText, type CheckDef } from "@/lib/concept-prompt";
import { runConcept, type ConceptState } from "@/lib/concept-pipeline";
import type { Candidate, SearchProvider } from "@/lib/reference-search";
import { loadSettings } from "@/components/app/settings-sheet";

export type JobPhase = "idle" | "briefing" | "brief" | "generating" | "done";

/** One press of Generate: four concepts, the checklist they were held to, and the references used. */
export type Round = { id: string; concepts: ConceptState[]; checks: CheckDef[]; refs: RefItem[] };

export type RefStatus = "idle" | "searching" | "ready" | "none" | "failed";

const queued = (): ConceptState[] =>
  CONCEPT_PROVIDERS.map((provider, index) => ({ provider, index, stage: "queued", image: null, results: [], fixes: 0, redraws: 0, note: "" }));

const settled = (c: ConceptState) => c.stage === "passed" || c.stage === "failed";

/** Roles automatic references fill: style and concept always, typography when the logo has letters. */
function autoRoles(brief: LogoBrief): ReferenceRole[] {
  const lettered = Boolean(requiredText(brief).name) || brief.logoType === "lettermark" || brief.logoType === "letterform";
  return lettered ? ["style", "concept", "typography"] : ["style", "concept"];
}

const notes = (refs: RefItem[]): ReferenceNote[] => refs.map((r) => ({ role: r.role, description: r.description }));

/**
 * One brief → rounds of four checked concepts. Each job (the Create page, every batch card) owns
 * its own inputs, references, abort controller and results, so jobs never block or overwrite each
 * other. Before the first round the AI picks references itself; after any round the user can
 * review them (remove, swap, re-role, add) and the next round uses the edited set.
 */
export function useBriefJob() {
  const [phase, setPhase] = useState<JobPhase>("idle");
  const [brief, setBrief] = useState<LogoBrief | null>(null);
  const [references, setReferences] = useState<ReferenceNote[]>([]);
  const [refs, setRefs] = useState<RefItem[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [provider, setProvider] = useState<SearchProvider | null>(null);
  const [refStatus, setRefStatus] = useState<RefStatus>("idle");
  const [rounds, setRounds] = useState<Round[]>([]);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  // Search candidates the user removed (never picked again) and whether auto-pick already ran.
  const removed = useRef<Set<string>>(new Set());
  const picked = useRef(false);
  const refsRef = useRef<RefItem[]>([]);
  refsRef.current = refs;

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

  /** Notes + uploaded references → brief. Returns it so callers can go straight on to generating. */
  const makeBrief = useCallback(async (text: string, uploads: PreparedRef[]) => {
    const abort = fresh();
    setPhase("briefing");
    setError(null);
    try {
      const out = await cleanBrief(text, uploads, abort.signal);
      if (abort.signal.aborted) return null;
      const items: RefItem[] = uploads.map((u, i) => ({ id: u.id, role: u.role, description: out.references[i]?.description ?? "", image: u.preview, signature: u.signature, auto: false })).filter((r) => r.description);
      setBrief(out.brief);
      setReferences(out.references);
      setRefs(items);
      setCandidates([]);
      setProvider(null);
      setRefStatus("idle");
      removed.current = new Set();
      picked.current = false;
      setRounds([]);
      setPhase("brief");
      return { brief: out.brief, refs: items };
    } catch (e) {
      if (abort.signal.aborted) return null;
      setError(e instanceof Error ? e.message.replace(/^\d{3}\s/, "") : "Couldn't read your brief.");
      setPhase("idle");
      return null;
    }
  }, []);

  /** Fills the roles no reference covers yet. Failure never blocks generating. */
  const autoPick = async (b: LogoBrief, current: RefItem[], signal: AbortSignal) => {
    const missing = autoRoles(b).filter((r) => !current.some((x) => x.role === r));
    if (!missing.length) return current;
    setRefStatus("searching");
    try {
      const found = await findAutoRefs(b, { roles: missing, exclude: [...removed.current] }, signal);
      if (signal.aborted) return current;
      setCandidates(found.candidates);
      setProvider(found.provider);
      const next = [...current, ...found.refs];
      setRefStatus(found.refs.length ? "ready" : "none");
      return next;
    } catch {
      if (!signal.aborted) setRefStatus("failed");
      return current;
    }
  };

  /** A new round: references are picked first (first round only), then four concepts in parallel. */
  const generate = useCallback(async (input?: { brief: LogoBrief; refs: RefItem[] }) => {
    const b = input?.brief ?? brief;
    if (!b) return;
    const abort = fresh();
    const id = crypto.randomUUID();
    let use = input?.refs ?? refsRef.current;
    setRounds((all) => [{ id, concepts: queued(), checks: [], refs: use }, ...all]);
    setPhase("generating");
    setError(null);
    if (!picked.current && loadSettings().autoRefs) {
      picked.current = true;
      use = await autoPick(b, use, abort.signal);
      if (abort.signal.aborted) return;
      setRefs(use);
    }
    const job = { brief: b, references: notes(use), signatures: use.map((r) => r.signature) };
    const checks = checklist(b, use.length > 0);
    const deps = conceptDeps(job, checks);
    setRounds((all) => all.map((r) => (r.id === id ? { ...r, checks, refs: use } : r)));
    await Promise.all(
      CONCEPT_PROVIDERS.map((p, index) =>
        runConcept({ provider: p, index, checks }, deps, abort.signal, (s) => {
          if (abort.signal.aborted) return;
          setRounds((all) => all.map((r) => (r.id === id ? { ...r, concepts: r.concepts.map((c) => (c.index === index ? s : c)) } : r)));
        }).catch(() => undefined),
      ),
    );
    if (!abort.signal.aborted) {
      controller.current = null;
      setPhase("done");
    }
  }, [brief]);

  const cancel = useCallback(() => {
    if (controller.current) stopUnfinished();
    controller.current?.abort();
    controller.current = null;
    setPhase((p) => (p === "briefing" ? "idle" : p === "generating" ? "done" : p));
    setRefStatus((s) => (s === "searching" ? "idle" : s));
  }, []);

  // ---------- reference review (applies to the next round) ----------

  const removeRef = useCallback((id: string) => {
    const r = refsRef.current.find((x) => x.id === id);
    if (r?.candidate) removed.current.add(r.candidate.id);
    setRefs((all) => all.filter((x) => x.id !== id));
  }, []);

  /** Re-describes a reference for a new role (its description is role-limited). */
  const changeRole = useCallback(async (id: string, role: ReferenceRole) => {
    const r = refsRef.current.find((x) => x.id === id);
    if (!r || r.role === role) return;
    const file = r.candidate ? undefined : await fetch(r.image).then((x) => x.blob()).then((blob) => new File([blob], "reference.png", { type: blob.type || "image/png" }));
    const next = await describeRef(role, r.candidate ? { candidate: r.candidate } : { file: file! });
    setRefs((all) => all.map((x) => (x.id === id ? { ...next, id, auto: r.auto } : x)));
  }, []);

  /** Uses a search candidate for a role, replacing the reference that held that role. */
  const useCandidate = useCallback(async (candidate: Candidate, role: ReferenceRole) => {
    const next = await describeRef(role, { candidate });
    setRefs((all) => {
      const old = all.find((x) => x.role === role);
      if (old?.candidate) removed.current.add(old.candidate.id);
      return [...all.filter((x) => x.role !== role), next];
    });
  }, []);

  const addUpload = useCallback(async (file: File, role: ReferenceRole) => {
    const next = await describeRef(role, { file });
    setRefs((all) => [...all, { ...next, auto: false }]);
  }, []);

  /** Searches again, skipping everything shown so far, and replaces the AI's picks. */
  const findNewRefs = useCallback(async () => {
    if (!brief) return;
    const abort = new AbortController();
    const kept = refsRef.current.filter((r) => !r.auto);
    for (const r of refsRef.current) if (r.candidate) removed.current.add(r.candidate.id);
    for (const c of candidates.slice(0, 16)) removed.current.add(c.id);
    picked.current = true;
    const next = await autoPick(brief, kept, abort.signal);
    setRefs(next);
  }, [brief, candidates]);

  const latest = rounds[0];
  return {
    phase, setPhase, brief, setBrief, references, rounds, error, makeBrief, generate, cancel,
    refs, candidates, provider, refStatus, removeRef, changeRole, useCandidate, addUpload, findNewRefs,
    /** The newest round (what batch cards show). */
    concepts: latest?.concepts ?? [],
    checks: latest?.checks ?? [],
  };
}

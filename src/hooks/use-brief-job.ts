import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_REFERENCES, type LogoBrief, type ReferenceNote, type ReferenceRole } from "@/lib/brief";
import { findLinks, LINK_CONTEXT_HEADER } from "@/lib/link-reference";
import { cleanBrief, conceptDeps, describeRef, findAutoRefs, measurePalette, openLink, type PreparedRef, type RefItem } from "@/lib/concept-client";
import { buildPalette, paletteToColors } from "@/lib/palette";
import { checklist, conceptProviders, requiredText, type CheckDef } from "@/lib/concept-prompt";
import { runConcept, type ConceptState } from "@/lib/concept-pipeline";
import type { Candidate, SearchProvider } from "@/lib/reference-search";
import { loadSettings } from "@/components/app/settings-sheet";
import { loadSaved, restoreSnapshot, saveSoon, type JobSnapshot } from "@/lib/persist";

export type JobPhase = "idle" | "briefing" | "brief" | "generating" | "done";

/** One press of Generate: four concepts, the checklist they were held to, and the references used. */
export type Round = { id: string; concepts: ConceptState[]; checks: CheckDef[]; refs: RefItem[] };

export type RefStatus = "idle" | "searching" | "ready" | "none" | "failed";

const queued = (providers = conceptProviders(loadSettings().grok)): ConceptState[] =>
  providers.map((provider, index) => ({ provider, index, stage: "queued", image: null, results: [], fixes: 0, redraws: 0, note: "" }));

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
/** Pictures that must survive a reload are stored as data URLs (object URLs die with the page). */
const toDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Could not read the image."));
    r.readAsDataURL(blob);
  });

/**
 * `persistKey`: autosave this job on the device under that key and restore it on load (see
 * persist.ts). `ready` turns true once restoring has finished; `restored` says whether there was
 * saved work, so callers that auto-start (batch cards) don't start again over it.
 */
export function useBriefJob(persistKey?: string) {
  const [phase, setPhase] = useState<JobPhase>("idle");
  const [brief, setBrief] = useState<LogoBrief | null>(null);
  const [references, setReferences] = useState<ReferenceNote[]>([]);
  const [refs, setRefs] = useState<RefItem[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [provider, setProvider] = useState<SearchProvider | null>(null);
  const [refStatus, setRefStatus] = useState<RefStatus>("idle");
  const [rounds, setRounds] = useState<Round[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** Non-blocking news, e.g. a link in the brief that couldn't be opened. */
  const [notice, setNotice] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  // Search candidates the user removed (never picked again) and whether auto-pick already ran.
  const removed = useRef<Set<string>>(new Set());
  const picked = useRef(false);
  const refsRef = useRef<RefItem[]>([]);
  refsRef.current = refs;
  const [ready, setReady] = useState(!persistKey);
  const [restored, setRestored] = useState(false);

  // Restore saved work once, before anything else runs.
  useEffect(() => {
    if (!persistKey) return;
    let live = true;
    void loadSaved<JobSnapshot>(persistKey).then((raw) => {
      if (!live) return;
      const snap = restoreSnapshot(raw);
      if (snap && (snap.brief || snap.rounds.length)) {
        setPhase(snap.phase);
        setBrief(snap.brief);
        setReferences(snap.references);
        setRefs(snap.refs);
        setCandidates(snap.candidates);
        setProvider(snap.provider);
        setRounds(snap.rounds);
        picked.current = snap.picked;
        setRestored(true);
      }
      setReady(true);
    });
    return () => { live = false; };
  }, [persistKey]);

  // Autosave every change (debounced), once restoring is done.
  useEffect(() => {
    if (!persistKey || !ready) return;
    const snap: JobSnapshot = { v: 1, phase, brief, references, refs, candidates, provider, rounds, picked: picked.current };
    saveSoon(persistKey, snap);
  }, [persistKey, ready, phase, brief, references, refs, candidates, provider, rounds]);

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
    setNotice(null);
    try {
      // Links in the notes are opened as references (their images, for the role named beside them)
      // and their page titles go to the brief model as context. A link that fails never blocks.
      const links = findLinks(text);
      const opened = await Promise.all(links.map((l) => openLink(l.url, l.role, abort.signal).then((r) => ({ ok: true as const, r }), () => ({ ok: false as const, url: l.url }))));
      if (abort.signal.aborted) return null;
      const linkRefs = new Map<string, string>();
      const all = [...uploads];
      const contexts: string[] = [];
      for (const o of opened) {
        if (!o.ok) continue;
        contexts.push(o.r.context);
        if (o.r.ref && all.length < MAX_REFERENCES) { all.push(o.r.ref); linkRefs.set(o.r.ref.id, o.r.url); }
      }
      const failed = opened.filter((o) => !o.ok).map((o) => (o.ok ? "" : new URL(o.url).hostname.replace(/^www\./, "")));
      if (failed.length) setNotice(`Couldn't open ${failed.join(", ")}. Paste the page's text or upload a screenshot to use it.`);
      const notesFor = contexts.length ? `${text}\n\n${LINK_CONTEXT_HEADER}\n${contexts.map((c) => `- ${c}`).join("\n")}` : text;
      const out = await cleanBrief(notesFor, all, abort.signal);
      if (abort.signal.aborted) return null;
      const images = await Promise.all(all.map((u) => toDataUrl(u.file).catch(() => u.preview)));
      const items: RefItem[] = all.map((u, i) => ({ id: u.id, role: u.role, description: out.references[i]?.description ?? "", image: images[i]!, signature: u.signature, auto: false, link: linkRefs.get(u.id) })).filter((r) => r.description);
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

  /** Colour samples from the last reference search (real logos in this space). */
  const samplesRef = useRef<string[]>([]);

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
      samplesRef.current = found.samples;
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
    const providers = conceptProviders(loadSettings().grok);
    setRounds((all) => [{ id, concepts: queued(providers), checks: [], refs: use }, ...all]);
    setPhase("generating");
    setError(null);
    let brief_ = b;
    if (!picked.current) {
      picked.current = true;
      if (loadSettings().autoRefs) {
        use = await autoPick(b, use, abort.signal);
        if (abort.signal.aborted) return;
        setRefs(use);
      }
      // No colours in the brief: build a palette from the colours real logos in this space use
      // (measured from the reference samples), shaped by colour theory. The user's colours always win.
      if (!b.colors.length) {
        const palette = samplesRef.current.length ? await measurePalette(samplesRef.current, b).catch(() => buildPalette([], b)) : buildPalette([], b);
        if (abort.signal.aborted) return;
        brief_ = { ...b, colors: paletteToColors(palette) };
        setBrief(brief_);
      }
    }
    const job = { brief: brief_, references: notes(use), signatures: use.map((r) => r.signature) };
    const checks = checklist(brief_, use.length > 0);
    const deps = conceptDeps(job, checks);
    setRounds((all) => all.map((r) => (r.id === id ? { ...r, checks, refs: use } : r)));
    await Promise.all(
      providers.map((p, index) =>
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
    setRefs((all) => all.map((x) => (x.id === id ? { ...next, id, auto: r.auto, link: r.link } : x)));
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

  /** Adds a web page as a reference: its images, read for `role` only. */
  const addLink = useCallback(async (url: string, role: ReferenceRole) => {
    const opened = await openLink(url, role);
    if (!opened.ref) throw new Error("That page has no images LOGOO can read. Upload a screenshot of it instead.");
    const next = await describeRef(role, { file: opened.ref.file });
    setRefs((all) => [...all, { ...next, auto: false, link: url }]);
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
    phase, setPhase, brief, setBrief, references, rounds, error, makeBrief, generate, cancel, ready, restored,
    refs, candidates, provider, refStatus, removeRef, changeRole, useCandidate, addUpload, addLink, findNewRefs, notice,
    /** The newest round (what batch cards show). */
    concepts: latest?.concepts ?? [],
    checks: latest?.checks ?? [],
  };
}

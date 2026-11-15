// Autosave on this device (IndexedDB: localStorage is too small for concept images). Every access
// is guarded — private mode, blocked storage or a missing API just means nothing is saved, never
// an error — and nothing leaves the device.
import type { LogoBrief, ReferenceNote } from "@/lib/brief";
import type { RefItem } from "@/lib/concept-client";
import type { ConceptState } from "@/lib/concept-pipeline";
import type { CheckDef } from "@/lib/concept-prompt";
import type { Candidate, SearchProvider } from "@/lib/reference-search";

const DB = "logoo";
const STORE = "autosave";

let opening: Promise<IDBDatabase | null> | null = null;
function db(): Promise<IDBDatabase | null> {
  if (opening) return opening;
  opening = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const d = await db();
  if (!d) return undefined;
  return new Promise((resolve) => {
    try {
      const tx = d.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => resolve(undefined);
      tx.onabort = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

export const loadSaved = <T>(key: string) => run<T>("readonly", (s) => s.get(key) as IDBRequest<T>);
export const saveSaved = (key: string, value: unknown) => run("readwrite", (s) => { s.put(value, key); });
export const removeSaved = (key: string) => run("readwrite", (s) => { s.delete(key); });
/** Clears saved work; "My references" (key "library", library.ts) is kept — it is the designer's taste, not a job. */
export const clearSaved = () =>
  run("readwrite", (s) => {
    const keys = s.getAllKeys();
    keys.onsuccess = () => keys.result.forEach((k) => { if (k !== "library") s.delete(k); });
  });

/** Saves at most every `ms` per key, keeping only the latest value (cheap during streaming). */
const timers = new Map<string, ReturnType<typeof setTimeout>>();
export function saveSoon(key: string, value: unknown, ms = 500) {
  const t = timers.get(key);
  if (t) clearTimeout(t);
  timers.set(key, setTimeout(() => { timers.delete(key); void saveSaved(key, value); }, ms));
}

/** A job (Create page or one batch card) as saved: everything needed to show it again. */
export type JobSnapshot = {
  v: 1;
  phase: "idle" | "briefing" | "brief" | "generating" | "done";
  brief: LogoBrief | null;
  references: ReferenceNote[];
  refs: RefItem[];
  candidates: Candidate[];
  provider: SearchProvider | null;
  rounds: { id: string; concepts: ConceptState[]; checks: CheckDef[]; refs: RefItem[] }[];
  picked: boolean;
};

const settled = (c: ConceptState) => c.stage === "passed" || c.stage === "failed";

/**
 * A saved job ready to show again. Work that was in flight when the page died can't resume, so
 * unfinished concepts become "Interrupted" (never left spinning) and a job that was briefing or
 * generating comes back idle or done — nothing restarts by itself or spends credits.
 */
export function restoreSnapshot(raw: unknown): JobSnapshot | null {
  const s = raw as Partial<JobSnapshot> | null | undefined;
  if (!s || s.v !== 1 || !Array.isArray(s.rounds)) return null;
  const rounds = s.rounds.map((r) => ({
    ...r,
    concepts: (r.concepts ?? []).map((c) => (settled(c) ? c : { ...c, stage: "failed" as const, note: "Interrupted" })),
  }));
  const phase = s.phase === "generating" ? (rounds.length ? "done" : s.brief ? "brief" : "idle") : s.phase === "briefing" ? "idle" : (s.phase ?? "idle");
  return {
    v: 1,
    phase,
    brief: s.brief ?? null,
    references: s.references ?? [],
    refs: s.refs ?? [],
    candidates: s.candidates ?? [],
    provider: s.provider ?? null,
    rounds,
    // Only a search that really ran (or the user editing references) counts: a restored brief
    // whose search failed or was cut off searches again on its next round.
    picked: Boolean(s.picked),
  };
}

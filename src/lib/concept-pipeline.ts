// The hand-off loop every concept goes through before anyone sees it (no DOM; dependencies are
// injected so it is tested without live AI): draw → check every box → fix the failed blocking
// boxes → check again … and, if fixing doesn't get there, start over with a fresh drawing. A
// concept is shown when every blocking box passes; the other boxes are notes on it.
import type { CheckDef, CheckResult, Provider } from "@/lib/concept-prompt";

export type ConceptStage = "queued" | "drawing" | "checking" | "fixing" | "redrawing" | "waiting" | "passed" | "failed";

export type ConceptState = {
  provider: Provider;
  index: number;
  stage: ConceptStage;
  /** Latest image (a data URL), including partial frames while drawing. */
  image: string | null;
  results: CheckResult[];
  /** Fix rounds used so far, and fresh drawings started. */
  fixes: number;
  redraws: number;
  note: string;
};

export type DrawRequest = { provider: Provider; index: number; draft?: string; issues?: string[] };

export type ConceptDeps = {
  draw: (req: DrawRequest, onFrame: (src: string) => void, signal: AbortSignal) => Promise<string>;
  /** Code checks (measured on the pixels). */
  auto: (src: string) => Promise<CheckResult[]>;
  /** AI review. */
  review: (src: string, signal: AbortSignal) => Promise<CheckResult[]>;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
};

/** How hard a concept may try: 2 fix rounds per drawing, 1 fresh redraw, about 3 minutes. */
export const BUDGET = { fixes: 2, redraws: 1, ms: 180_000, retries: 3 } as const;

/** Rate limits and dropped connections are retried with backoff; other errors are final. */
export function isRetryable(e: unknown) {
  if (!(e instanceof Error) || e.name === "AbortError") return false;
  return /\b(429|502|503|504)\b|rate limit|busy|network|fetch failed|Failed to fetch|ended without/i.test(e.message);
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(t); reject(signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError")); }, { once: true });
  });

/** Orders results like the checklist, so the UI ticks boxes in a stable order. */
function ordered(checks: CheckDef[], results: CheckResult[]) {
  return checks.map((c) => results.find((r) => r.id === c.id)).filter((r): r is CheckResult => Boolean(r));
}

export async function runConcept(
  start: { provider: Provider; index: number; checks: CheckDef[] },
  deps: ConceptDeps,
  signal: AbortSignal,
  onUpdate: (s: ConceptState) => void,
): Promise<ConceptState> {
  const wait = deps.wait ?? sleep;
  const now = deps.now ?? Date.now;
  const began = now();
  let state: ConceptState = { provider: start.provider, index: start.index, stage: "drawing", image: null, results: [], fixes: 0, redraws: 0, note: "" };
  const set = (patch: Partial<ConceptState>) => {
    state = { ...state, ...patch };
    if (!signal.aborted) onUpdate(state);
  };

  async function retry<T>(fn: () => Promise<T>, stage: ConceptStage): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (e) {
        signal.throwIfAborted();
        if (!isRetryable(e) || attempt >= BUDGET.retries) throw e;
        set({ stage: "waiting", note: "The AI is busy — retrying shortly…" });
        await wait(4000 * 2 ** attempt, signal);
        set({ stage, note: "" });
      }
    }
  }

  const draw = (req: DrawRequest, stage: ConceptStage) =>
    retry(() => deps.draw(req, (src) => set({ image: src }), signal), stage);

  try {
    set({});
    for (let redraw = 0; redraw <= BUDGET.redraws; redraw++) {
      const stage: ConceptStage = redraw ? "redrawing" : "drawing";
      set({ stage, redraws: redraw, results: [], note: "" });
      let src = await draw({ provider: start.provider, index: start.index }, stage);
      for (let fix = 0; ; fix++) {
        signal.throwIfAborted();
        set({ stage: "checking", image: src });
        const [auto, ai] = await Promise.all([deps.auto(src), retry(() => deps.review(src, signal), "checking")]);
        const results = ordered(start.checks, [...auto, ...ai]);
        // Only blocking boxes decide; the rest are notes shown on the concept.
        const blocking = start.checks.filter((c) => c.blocking);
        const failed = results.filter((r) => !r.pass && blocking.some((c) => c.id === r.id));
        set({ results });
        if (!failed.length && blocking.every((c) => results.some((r) => r.id === c.id))) {
          set({ stage: "passed", note: "" });
          return state;
        }
        const outOfTime = now() - began > BUDGET.ms;
        if (fix >= BUDGET.fixes || outOfTime) {
          if (outOfTime) redraw = BUDGET.redraws; // no time for a fresh start either
          break;
        }
        set({ stage: "fixing", fixes: state.fixes + 1 });
        src = await draw({ provider: start.provider, index: start.index, draft: src, issues: failed.map((f) => f.issue) }, "fixing");
      }
    }
    set({ stage: "failed", note: "Didn't pass every check, so it isn't shown." });
  } catch (e) {
    signal.throwIfAborted();
    set({ stage: "failed", note: e instanceof Error ? e.message.replace(/^Image generation failed: /, "") : "This concept couldn't be made." });
  }
  return state;
}

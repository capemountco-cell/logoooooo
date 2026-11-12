import { ArrowLeft, Sparkles, TriangleAlert } from "lucide-react";
import { LOGO_TYPES, type LogoBrief, type ReferenceNote } from "@/lib/brief";
import { cn } from "@/lib/utils";

const csv = (v: string[]) => v.join(", ");
const fromCsv = (v: string) => v.split(",").map((s) => s.trim()).filter(Boolean);

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={cn("flex flex-col gap-1.5", wide && "sm:col-span-2")}>
      <span className="text-xs font-semibold text-subtle">{label}</span>
      {children}
    </label>
  );
}

const input = "h-11 rounded-xl border border-border bg-field px-3.5 text-[15px] outline-none focus:border-foreground focus:bg-field-focus";

/** The cleaned-up brief, every field editable, with the logo type the AI picked (and why). */
export function BriefCard({
  brief, references, onChange, onGenerate, onBack, backLabel = "Edit notes",
}: {
  brief: LogoBrief;
  references: ReferenceNote[];
  onChange: (b: LogoBrief) => void;
  onGenerate: () => void;
  onBack: () => void;
  backLabel?: string;
}) {
  const set = (patch: Partial<LogoBrief>) => onChange({ ...brief, ...patch });
  const recommended = new Set([brief.logoType, ...brief.alternativeTypes]);
  const needsName = !brief.brandName.trim();
  return (
    <section aria-label="Your brief" className="flex w-full max-w-[720px] flex-col gap-5 rounded-[24px] border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-[-0.01em]">Your brief</h2>
          <p className="text-[13px] text-muted-foreground">Cleaned up from your notes. Fix anything before generating.</p>
        </div>
        <button type="button" onClick={onBack} className="inline-flex h-10 items-center gap-1.5 rounded-xl px-2.5 text-sm font-medium text-subtle hover:text-foreground">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {backLabel}
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Brand name (spelled exactly)">
          <input value={brief.brandName} onChange={(e) => set({ brandName: e.target.value })} placeholder="Required for lettering" className={cn(input, needsName && "border-pending")} />
        </Field>
        <Field label="Tagline (optional)">
          <input value={brief.tagline} onChange={(e) => set({ tagline: e.target.value })} placeholder="None" className={input} />
        </Field>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-xs font-semibold text-subtle">Logo type</legend>
        <div role="radiogroup" aria-label="Logo type" className="flex flex-wrap gap-1.5">
          {LOGO_TYPES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={brief.logoType === t.id}
              onClick={() => set({ logoType: t.id })}
              title={t.rule}
              className={cn(
                "inline-flex h-10 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium",
                brief.logoType === t.id ? "border-foreground bg-foreground text-background" : recommended.has(t.id) ? "border-foreground/40 bg-transparent" : "border-border bg-transparent text-subtle",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        {brief.typeReason && (
          <p className="text-[13px] text-muted-foreground">
            <Sparkles className="mr-1 inline h-3.5 w-3.5 align-[-2px]" aria-hidden="true" />
            {brief.typeReason}
          </p>
        )}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="What it should say about the brand" wide>
          <textarea value={brief.summary} onChange={(e) => set({ summary: e.target.value })} rows={2} className="resize-none rounded-xl border border-border bg-field px-3.5 py-2.5 text-[15px] outline-none focus:border-foreground focus:bg-field-focus" />
        </Field>
        <Field label="Personality">
          <input value={csv(brief.personality)} onChange={(e) => set({ personality: fromCsv(e.target.value) })} placeholder="e.g. warm, modern" className={input} />
        </Field>
        <Field label="Colours">
          <input value={csv(brief.colors)} onChange={(e) => set({ colors: fromCsv(e.target.value) })} placeholder="Let the AI choose" className={input} />
        </Field>
        <Field label="Lettering">
          <input value={brief.typography} onChange={(e) => set({ typography: e.target.value })} placeholder="Let the AI choose" className={input} />
        </Field>
        <Field label="Symbol ideas">
          <input value={csv(brief.symbolIdeas)} onChange={(e) => set({ symbolIdeas: fromCsv(e.target.value) })} placeholder="Let the AI choose" className={input} />
        </Field>
        <Field label="Must have">
          <input value={csv(brief.mustHave)} onChange={(e) => set({ mustHave: fromCsv(e.target.value) })} placeholder="Nothing specific" className={input} />
        </Field>
        <Field label="Avoid">
          <input value={csv(brief.avoid)} onChange={(e) => set({ avoid: fromCsv(e.target.value) })} placeholder="Nothing specific" className={input} />
        </Field>
      </div>

      {references.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-xl bg-field p-3">
          <span className="text-xs font-semibold text-subtle">From your references</span>
          {references.map((r, i) => (
            <p key={i} className="text-[13px] text-subtle">
              <span className="font-semibold capitalize text-foreground">{r.role}:</span> {r.description}
            </p>
          ))}
        </div>
      )}

      {needsName && (
        <p className="flex items-center gap-2 rounded-xl bg-warn-bg px-3 py-2.5 text-[13px] text-warn">
          <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
          No brand name found. Add one, or pick a symbol-only type (Pictorial or Abstract).
        </p>
      )}

      <button
        type="button"
        onClick={onGenerate}
        disabled={needsName && !["pictorial", "abstract"].includes(brief.logoType)}
        className="inline-flex h-[50px] items-center justify-center gap-2 rounded-full bg-primary text-[15px] font-semibold text-primary-foreground disabled:opacity-40"
      >
        <Sparkles className="h-4 w-4" aria-hidden="true" />
        Generate 4 concepts
      </button>
      <p className="-mt-2 text-center text-xs text-muted-foreground">2 from OpenAI, 2 from Grok. Each one is checked and fixed before you see it.</p>
    </section>
  );
}

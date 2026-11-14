import { useState } from "react";
import { ExternalLink, ImagePlus, Link2, Loader2, RefreshCw, Sparkles, X } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { REFERENCE_ROLES, type ReferenceRole } from "@/lib/brief";
import type { RefItem } from "@/lib/concept-client";
import type { Candidate, SearchProvider } from "@/lib/reference-search";
import type { RefStatus } from "@/hooks/use-brief-job";
import { useImageDrop } from "@/hooks/use-image-drop";
import { cn } from "@/lib/utils";
import { cleanLink } from "@/lib/link-reference";

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

const roleLabel = (r: ReferenceRole) => REFERENCE_ROLES.find((x) => x.id === r)?.label ?? r;

/**
 * The references the AI picked (and any the user added), reviewed after a round: remove, change
 * role, swap in another search result, upload your own, or search again. Edits apply to the next
 * round; each reference only ever lends its role, as text.
 */
export function ReferenceReview({
  open, onOpenChange, refs, candidates, provider, status, onRemove, onRole, onCandidate, onUpload, onLink, onFindNew, onGenerate, busy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  refs: RefItem[];
  candidates: Candidate[];
  provider: SearchProvider | null;
  status: RefStatus;
  onRemove: (id: string) => void;
  onRole: (id: string, role: ReferenceRole) => Promise<void>;
  onCandidate: (c: Candidate, role: ReferenceRole) => Promise<void>;
  onUpload: (file: File, role: ReferenceRole) => Promise<void>;
  onLink: (url: string, role: ReferenceRole) => Promise<void>;
  onFindNew: () => Promise<void>;
  onGenerate: () => void;
  busy: boolean;
}) {
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [swapRole, setSwapRole] = useState<ReferenceRole>("style");
  const [link, setLink] = useState("");
  const [linkRole, setLinkRole] = useState<ReferenceRole>("style");
  const inUse = new Set(refs.map((r) => r.candidate?.id).filter(Boolean));
  const others = candidates.filter((c) => !inUse.has(c.id)).slice(0, 18);

  async function run(key: string, fn: () => Promise<void>) {
    setWorking(key);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^\d{3}\s/, "") : "That didn't work. Try again.");
    } finally {
      setWorking(null);
    }
  }
  const drop = useImageDrop((files) => { const f = files[0]; if (f) void run("upload", () => onUpload(f, swapRole)); }, Boolean(working));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-5 overflow-y-auto bg-card sm:max-w-[460px]">
        <SheetHeader>
          <SheetTitle>References</SheetTitle>
          <SheetDescription>
            Picked by LOGOO for this brief{provider ? ` (via ${provider === "brave" ? "Brave Search" : "Openverse"})` : ""}. The image AI looks at each one for its role only (or reads a description, if that's turned off in Settings); a concept that copies one is caught. Changes apply to the next round.
          </SheetDescription>
        </SheetHeader>

        {status === "searching" && (
          <p className="flex items-center gap-2 text-sm text-subtle" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Finding references…
          </p>
        )}

        <ul className="flex flex-col gap-3" aria-label="References in use">
          {refs.length === 0 && status !== "searching" && (
            <li className="rounded-[14px] border border-dashed border-line p-4 text-[13px] text-muted-foreground">
              {status === "failed" ? "The reference search didn't work this time." : "No references in use."} Search again, pick one below, or add your own.
            </li>
          )}
          {refs.map((r) => (
            <li key={r.id} className="flex gap-3 rounded-[14px] border border-border p-3">
              <img src={r.image} alt="" className="h-20 w-20 shrink-0 rounded-[10px] bg-artboard object-contain" />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <select
                    value={r.role}
                    disabled={Boolean(working)}
                    onChange={(e) => void run(r.id, () => onRole(r.id, e.target.value as ReferenceRole))}
                    aria-label="Use this reference for"
                    className="h-8 rounded-lg border border-border bg-field px-2 text-[13px] font-medium outline-none"
                  >
                    {REFERENCE_ROLES.map((x) => (
                      <option key={x.id} value={x.id}>{x.label}</option>
                    ))}
                  </select>
                  <button type="button" onClick={() => onRemove(r.id)} disabled={Boolean(working)} aria-label={`Remove ${roleLabel(r.role)} reference`} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground">
                    {working === r.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <X className="h-4 w-4" aria-hidden="true" />}
                  </button>
                </div>
                <p className="line-clamp-3 text-[12px] leading-snug text-subtle">{r.description}</p>
                <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  {r.auto ? <Sparkles className="h-3 w-3" aria-hidden="true" /> : <ImagePlus className="h-3 w-3" aria-hidden="true" />}
                  {r.auto ? "Picked by AI" : "Added by you"}
                  {r.link && (
                    <a href={r.link} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-0.5 underline-offset-2 hover:text-foreground hover:underline">
                      · {host(r.link)}
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  )}
                  {r.candidate?.source && (
                    <a href={r.candidate.source} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-0.5 underline-offset-2 hover:text-foreground hover:underline">
                      · {host(r.candidate.source)}
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={Boolean(working) || status === "searching"} onClick={() => void run("find", onFindNew)} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-border px-3.5 text-sm font-medium disabled:opacity-50">
            <RefreshCw className={cn("h-3.5 w-3.5", working === "find" && "animate-spin")} aria-hidden="true" />
            Find new references
          </button>
          <label {...drop.handlers} className={cn("inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-lg border border-dashed px-3.5 text-sm font-medium", drop.dragging ? "border-blue bg-blue/10" : "border-line hover:border-line-strong")}>
            {working === "upload" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />}
            Add your own
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" aria-label="Upload a reference" disabled={Boolean(working)} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void run("upload", () => onUpload(f, swapRole)); }} />
          </label>
        </div>

        <form
          className="flex flex-col gap-2"
          aria-label="Add a reference from a link"
          onSubmit={(e) => {
            e.preventDefault();
            const url = cleanLink(link);
            if (!url) { setError("That doesn't look like a web link."); return; }
            void run("link", async () => { await onLink(url, linkRole); setLink(""); });
          }}
        >
          <div className="flex gap-2">
            <input
              type="url"
              inputMode="url"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="Paste a link — a site, Dribbble shot, image…"
              aria-label="Reference link"
              disabled={Boolean(working)}
              className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-field px-3.5 text-[13px] outline-none placeholder:text-muted-foreground focus:bg-field-focus"
            />
            <select value={linkRole} onChange={(e) => setLinkRole(e.target.value as ReferenceRole)} aria-label="Use the link for" className="h-10 rounded-lg border border-border bg-field px-2.5 text-[12px] outline-none">
              {REFERENCE_ROLES.map((x) => (
                <option key={x.id} value={x.id}>{x.label}</option>
              ))}
            </select>
            <button type="submit" disabled={Boolean(working) || !link.trim()} aria-label="Add link as reference" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border disabled:opacity-50">
              {working === "link" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Link2 className="h-4 w-4" aria-hidden="true" />}
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">LOGOO opens the page and reads its images for that role only.</p>
        </form>

        {others.length > 0 && (
          <section className="flex flex-col gap-2.5" aria-label="Other search results">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold text-subtle">Other options — tap to use as</h3>
              <select value={swapRole} onChange={(e) => setSwapRole(e.target.value as ReferenceRole)} aria-label="Role for the option you tap" className="h-8 rounded-lg border border-border bg-field px-2 text-[12px] outline-none">
                {REFERENCE_ROLES.map((x) => (
                  <option key={x.id} value={x.id}>{x.label}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {others.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  disabled={Boolean(working)}
                  onClick={() => void run(c.id, () => onCandidate(c, swapRole))}
                  title={`${c.title} · ${host(c.source)}`}
                  aria-label={`Use ${c.title || "this image"} as ${roleLabel(swapRole)} reference`}
                  className="relative aspect-square overflow-hidden rounded-[10px] bg-artboard disabled:opacity-60"
                >
                  <img src={c.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                  {working === c.id && <span className="absolute inset-0 flex items-center justify-center bg-black/40"><Loader2 className="h-4 w-4 animate-spin text-white" aria-hidden="true" /></span>}
                </button>
              ))}
            </div>
          </section>
        )}

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

        <button type="button" disabled={busy || Boolean(working)} onClick={() => { onOpenChange(false); onGenerate(); }} className="mt-auto inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-primary text-[15px] font-semibold text-primary-foreground disabled:opacity-40">
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          Generate more with these
        </button>
      </SheetContent>
    </Sheet>
  );
}

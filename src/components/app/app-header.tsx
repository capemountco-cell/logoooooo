import { BrandMark } from "./brand";
import { SettingsSheet } from "./settings-sheet";
import { cn } from "@/lib/utils";

export type View = "create" | "batch" | "import";

const VIEWS: { id: View; label: string }[] = [
  { id: "create", label: "Create" },
  { id: "batch", label: "Batch" },
  { id: "import", label: "Import" },
];

export function AppHeader({ view, onView }: { view: View; onView: (v: View) => void }) {
  return (
    <header className="flex items-center justify-between gap-3 px-4 py-4 sm:px-7">
      <button type="button" onClick={() => onView("create")} className="inline-flex h-10 items-center text-foreground" aria-label="LOGOO home">
        <BrandMark height={12} />
      </button>
      <div className="flex items-center gap-2">
        <nav aria-label="Sections" className="flex gap-0.5 rounded-full border border-border p-1">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              aria-current={view === v.id ? "page" : undefined}
              onClick={() => onView(v.id)}
              className={cn("h-8 rounded-full px-3 text-[13px] font-medium sm:px-3.5", view === v.id ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
            >
              {v.label}
            </button>
          ))}
        </nav>
        <SettingsSheet />
      </div>
    </header>
  );
}

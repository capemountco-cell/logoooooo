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
      <button type="button" onClick={() => onView("create")} className="flex items-center gap-2.5 text-foreground" aria-label="Vectorthis home">
        <BrandMark />
        <span className="hidden text-[17px] font-semibold tracking-[-0.01em] sm:inline">Vectorthis</span>
      </button>
      <div className="flex items-center gap-2">
        <nav aria-label="Sections" className="flex gap-1 rounded-xl bg-muted p-1">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              aria-current={view === v.id ? "page" : undefined}
              onClick={() => onView(v.id)}
              className={cn("h-9 rounded-[9px] px-3 text-sm font-medium sm:px-3.5", view === v.id ? "bg-card text-foreground shadow-[0_1px_2px_rgba(17,17,17,0.08)]" : "text-subtle")}
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

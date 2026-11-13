import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { LayoutGrid, Settings, Sparkles, Upload } from "lucide-react";
import { BrandMark } from "./brand";
import { SettingsSheet } from "./settings-sheet";
import { MOD } from "./mac";
import { cn } from "@/lib/utils";

export type View = "create" | "batch" | "import";

const VIEWS: { id: View; label: string; icon: ReactNode; key: string }[] = [
  { id: "create", label: "Create", key: "1", icon: <Sparkles className="h-[22px] w-[22px]" strokeWidth={1.6} aria-hidden="true" /> },
  { id: "batch", label: "Batch", key: "2", icon: <LayoutGrid className="h-[22px] w-[22px]" strokeWidth={1.6} aria-hidden="true" /> },
  { id: "import", label: "Import", key: "3", icon: <Upload className="h-[22px] w-[22px]" strokeWidth={1.6} aria-hidden="true" /> },
];

/** A Mac toolbar item (Camu's .tool): icon over label, a soft fill when current. */
export const ToolButton = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<"button"> & { current?: boolean; icon: ReactNode; label: string; badge?: number | undefined }>(
  function ToolButton({ current, icon, label, badge, className, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        aria-current={current ? "page" : undefined}
        {...rest}
        className={cn(
          "relative flex h-[54px] w-[72px] flex-col items-center justify-center gap-1 rounded-[10px] text-[12px] font-medium transition-colors sm:h-[58px] sm:w-[88px]",
          current ? "bg-[#1c1d1f] font-semibold text-foreground shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]" : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
          className,
        )}
      >
        {icon}
        <span>{label}</span>
        {badge ? (
          <span className="absolute top-1 right-3 h-4 min-w-[18px] rounded-lg bg-pending px-1.5 text-center text-[11px] leading-4 font-bold text-background sm:right-[18px]">{badge}</span>
        ) : null}
      </button>
    );
  },
);

/**
 * The window top, laid out like Camu's Mac toolbar: the LOGOO wordmark centred in the title row,
 * then large icon-and-label tools — places on the left, settings on the right. No window buttons:
 * LOGOO runs in the browser, whose own frame surrounds it.
 */
export function AppHeader({ view, onView, badges, settingsOpen, onSettings }: { view: View; onView: (v: View) => void; badges?: Partial<Record<View, number>>; settingsOpen?: boolean; onSettings?: (open: boolean) => void }) {
  return (
    <header className="flex flex-none flex-col">
      <div className="flex h-10 items-center justify-center">
        <button type="button" onClick={() => onView("create")} className="inline-flex h-8 items-center rounded-md px-2 text-foreground" aria-label="LOGOO home">
          <BrandMark height={12} />
        </button>
      </div>
      <nav aria-label="Sections" className="flex items-end justify-between px-2 pb-1 sm:px-3">
        <div className="flex gap-1">
          {VIEWS.map((v) => (
            <ToolButton key={v.id} current={view === v.id} icon={v.icon} label={v.label} badge={badges?.[v.id]} title={`${v.label} (${MOD}${v.key})`} onClick={() => onView(v.id)} />
          ))}
        </div>
        <SettingsSheet
          {...(settingsOpen !== undefined ? { open: settingsOpen } : {})}
          {...(onSettings ? { onOpenChange: onSettings } : {})}
          trigger={<ToolButton icon={<Settings className="h-[22px] w-[22px]" strokeWidth={1.6} aria-hidden="true" />} label="Settings" aria-label="Settings" title={`Settings (${MOD},)`} />}
        />
      </nav>
    </header>
  );
}

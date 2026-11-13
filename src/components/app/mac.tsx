// Mac-app building blocks in Camu's language (see AGENTS.md › UI): a panel header row, a status
// bar, cards with a grey head strip, compact 28px buttons with keyboard hints, status dots, and a
// keyboard-shortcut hook. Every screen in the inset panel is built from these.
import { forwardRef, useEffect, useRef, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** ⌘ on Apple devices, Ctrl elsewhere. */
export const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "⌘" : "Ctrl+";

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  // Hidden on phones (no keyboard). The wrapper hides it: .kbd's own display would win over `hidden`.
  return <span className="hidden sm:inline-flex"><kbd className={cn("kbd font-sans", className)}>{children}</kbd></span>;
}

type BtnVariant = "default" | "primary" | "go" | "ok" | "ghost";

/** Camu's .btn: 28px tall, 8px radius, 13px medium; primary is the one indigo action. */
export const Btn = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<"button"> & { variant?: BtnVariant; kbd?: string | undefined; size?: "sm" | "md" }>(
  function Btn({ variant = "default", kbd, size = "sm", className, children, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        {...rest}
        className={cn(
          "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg px-3 text-[13px] font-medium whitespace-nowrap transition-colors disabled:opacity-50",
          size === "sm" ? "h-7" : "h-[34px] px-4",
          variant === "default" && "border border-input bg-card text-foreground hover:bg-secondary",
          variant === "primary" && "bg-primary font-semibold text-primary-foreground",
          variant === "go" && "bg-pending/15 font-semibold text-pending hover:bg-pending/25",
          variant === "ok" && "bg-success/15 font-semibold text-success hover:bg-success/25",
          variant === "ghost" && "text-subtle hover:bg-secondary hover:text-foreground",
          className,
        )}
      >
        {children}
        {kbd && <Kbd>{kbd}</Kbd>}
      </button>
    );
  },
);

/** The header row at the top of the panel: a 13px title, quiet meta, actions on the right. */
export function PanelHeader({ title, meta, children }: { title: ReactNode; meta?: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex min-h-[54px] flex-none flex-wrap items-center gap-x-2.5 gap-y-2 px-4 pt-1 pb-1 sm:px-6 sm:pr-4">
      <h1 className="truncate text-[13px] font-semibold">{title}</h1>
      {meta}
      <span className="flex-1" />
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}

/** The 28px status bar along the bottom of the panel. */
export function StatusBar({ children }: { children: ReactNode }) {
  return (
    <footer className="flex h-7 flex-none items-center gap-4 overflow-hidden border-t border-border px-4 text-[12px] whitespace-nowrap text-muted-foreground tabular-nums sm:px-6">
      {children}
    </footer>
  );
}

export function Dot({ tone, className }: { tone: "pending" | "success" | "destructive" | "muted"; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block h-2 w-2 shrink-0 rounded-full",
        tone === "pending" && "bg-pending",
        tone === "success" && "bg-success",
        tone === "destructive" && "bg-destructive",
        tone === "muted" && "border-[1.5px] border-muted-foreground",
        className,
      )}
    />
  );
}

/** Rounded status label with a coloured dot, like Camu's version pill. */
export function Pill({ tone, children, className }: { tone?: "pending" | "success" | "destructive" | "muted"; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-input bg-background pr-2.5 pl-2 text-[12px] whitespace-nowrap text-subtle", !tone && "pl-2.5", className)}>
      {tone && <Dot tone={tone} />}
      {children}
    </span>
  );
}

/** A raised card with a grey head strip (Camu's .group / .group-head). */
export function Card({ title, count, actions, children, className, bodyClassName, ...rest }: { title?: ReactNode; count?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string } & Omit<ComponentPropsWithoutRef<"section">, "title">) {
  return (
    <section {...rest} className={cn("flex-none overflow-hidden rounded-xl border border-border bg-card", className)}>
      {title !== undefined && (
        <div className="flex h-9 items-center gap-2 border-b border-border bg-card-head px-4 font-medium text-subtle">
          {title}
          {count !== undefined && <span className="text-muted-foreground tabular-nums">{count}</span>}
          {actions && <><span className="flex-1" />{actions}</>}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/** A 34px list row with a hairline between rows. */
export function Row({ className, children, ...rest }: ComponentPropsWithoutRef<"div">) {
  return (
    <div {...rest} className={cn("flex min-h-[34px] items-center gap-3 border-b border-border/50 px-4 py-1.5 last:border-b-0", className)}>
      {children}
    </div>
  );
}

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return Boolean(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable));
};

export type Shortcut = {
  /** e.g. "mod+enter", "mod+1", "e", "arrowright", "escape", "mod+s", "mod+,". */
  keys: string;
  run: (e: KeyboardEvent) => void;
  /** Plain-key shortcuts never fire while typing; mod shortcuts do unless this is false. */
  whileTyping?: boolean;
};

function matches(e: KeyboardEvent, keys: string) {
  const parts = keys.toLowerCase().split("+");
  const key = parts.pop()!;
  const mod = parts.includes("mod");
  if (mod !== (e.metaKey || e.ctrlKey)) return false;
  if (parts.includes("shift") !== e.shiftKey) return false;
  if (e.altKey) return false;
  return e.key.toLowerCase() === key;
}

/**
 * Keyboard shortcuts while `enabled` (e.g. only for the visible screen). Plain keys are ignored
 * while the user is typing in a field; open dialogs (Radix) block them via `[role=dialog]`.
 */
export function useShortcuts(shortcuts: Shortcut[], enabled = true) {
  const ref = useRef(shortcuts);
  ref.current = shortcuts;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const inDialog = (e.target as HTMLElement | null)?.closest?.("[role=dialog]");
      for (const s of ref.current) {
        if (!matches(e, s.keys)) continue;
        const mod = s.keys.toLowerCase().includes("mod+");
        if (typing(e.target) && (!mod || s.whileTyping === false)) continue;
        if (inDialog && !mod) continue;
        e.preventDefault();
        s.run(e);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}

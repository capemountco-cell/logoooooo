import { useEffect, useState, type ReactNode } from "react";
import { Settings } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { clearSaved } from "@/lib/persist";

export type AppSettings = { autoRefs: boolean; grok: boolean; identity: boolean; mockups: boolean };
const KEY = "vectorthis.settings.v1";
export const DEFAULT_SETTINGS: AppSettings = { autoRefs: true, grok: false, identity: false, mockups: false };

/** Settings live only in this browser; every access is guarded (storage may be unavailable). */
export function loadSettings(): AppSettings {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as Partial<AppSettings>) : {};
    return { autoRefs: v.autoRefs !== false, grok: v.grok === true, identity: v.identity === true, mockups: v.mockups === true };
  } catch {
    return DEFAULT_SETTINGS;
  }
}
/** Concepts per round for the current settings (3 with Grok off, 4 with it on). */
export function roundSize() {
  return loadSettings().grok ? 4 : 3;
}

function saveSettings(s: AppSettings) {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(s));
  } catch {
    /* settings still apply for this visit */
  }
}

/** Settings: automatic references (on by default), and optional extras the user opts in to. */
/** `trigger`: the button that opens the sheet (the toolbar's Settings tool). */
export function SettingsSheet({ trigger }: { trigger?: ReactNode } = {}) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  useEffect(() => setSettings(loadSettings()), []);
  const set = (patch: Partial<AppSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveSettings(next);
  };
  const rows: { key: keyof AppSettings; title: string; note: string; soon?: boolean }[] = [
    { key: "autoRefs", title: "Find references automatically", note: "Before each first round, LOGOO searches for reference logos and picks the best for style, concept and lettering. Review them after any round." },
    { key: "grok", title: "Use Grok too", note: "Off: each round is 3 concepts from OpenAI. On: 4 concepts per round — 2 from OpenAI, 2 from Grok — for more variety." },
    { key: "identity", title: "Brand identity package", note: "Palette, type pairing, logo versions, favicon and social avatars.", soon: true },
    { key: "mockups", title: "Mockups", note: "Your logo on cards, signage and merchandise. Uses extra image generations.", soon: true },
  ];
  return (
    <Sheet>
      <SheetTrigger asChild>
        {trigger ?? (
          <button type="button" aria-label="Settings" className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground">
            <Settings className="h-[18px] w-[18px]" aria-hidden="true" />
          </button>
        )}
      </SheetTrigger>
      <SheetContent className="flex flex-col gap-5 bg-card">
        <SheetHeader>
          <SheetTitle>Settings</SheetTitle>
          <SheetDescription>Saved on this device.</SheetDescription>
        </SheetHeader>
        <ul className="flex flex-col gap-3">
          {rows.map((r) => (
            <li key={r.key} className="flex items-start justify-between gap-4 rounded-[14px] border border-border p-3.5">
              <span className="flex flex-col gap-0.5">
                <span className="flex items-center gap-2 text-[15px] font-semibold">
                  {r.title}
                  {r.soon && <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-[0.04em] text-muted-foreground uppercase">Coming soon</span>}
                </span>
                <span className="text-[13px] text-muted-foreground">{r.note}</span>
              </span>
              <Switch checked={settings[r.key]} onCheckedChange={(v) => set({ [r.key]: v })} aria-label={r.title} disabled={r.soon} />
            </li>
          ))}
        </ul>
        <SavedWork />
      </SheetContent>
    </Sheet>
  );
}

/** Autosaved work lives only on this device; clearing needs a second tap. */
function SavedWork() {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="flex flex-col gap-2 rounded-[14px] border border-border p-3.5">
      <span className="text-[15px] font-semibold">Saved work</span>
      <span className="text-[13px] text-muted-foreground">Briefs, concepts and batch jobs save automatically on this device, so a crash or refresh never loses them. Nothing is uploaded.</span>
      {confirm ? (
        <div className="flex gap-2">
          <button type="button" onClick={() => { void clearSaved().then(() => window.location.reload()); }} className="h-10 flex-1 rounded-lg bg-destructive text-sm font-semibold text-destructive-foreground">Clear everything</button>
          <button type="button" onClick={() => setConfirm(false)} className="h-10 flex-1 rounded-lg border border-border text-sm font-medium">Cancel</button>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirm(true)} className="h-10 rounded-lg border border-border text-sm font-medium">Clear saved work</button>
      )}
    </div>
  );
}

import { useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { MAX_REFERENCES, REFERENCE_ROLES, type ReferenceRole } from "@/lib/brief";
import { prepareRef, type PreparedRef } from "@/lib/concept-client";
import { useImageDrop } from "@/hooks/use-image-drop";
import { cn } from "@/lib/utils";

/**
 * Reference images, each with one job (typography, style, colour…). The AI only ever takes that
 * one quality from it, so a reference can't be copied wholesale.
 */
export function ReferencePicker({ refs, onChange, disabled }: { refs: PreparedRef[]; onChange: (refs: PreparedRef[]) => void; disabled?: boolean }) {
  const [error, setError] = useState("");
  const full = refs.length >= MAX_REFERENCES;
  async function add(files: File[]) {
    setError("");
    const room = MAX_REFERENCES - refs.length;
    if (room <= 0) return;
    try {
      const added = await Promise.all(files.slice(0, room).map((f) => prepareRef(f, "style")));
      onChange([...refs, ...added]);
    } catch {
      setError("That image couldn't be read. Try a PNG or JPG.");
    }
  }
  const drop = useImageDrop((files) => void add(files), disabled || full);
  const setRole = (id: string, role: ReferenceRole) => onChange(refs.map((r) => (r.id === id ? { ...r, role } : r)));
  const remove = (id: string) => {
    const r = refs.find((x) => x.id === id);
    if (r) URL.revokeObjectURL(r.preview);
    onChange(refs.filter((x) => x.id !== id));
  };
  return (
    <div className="flex flex-col gap-1.5">
      <ul className="flex flex-wrap items-center gap-2" aria-label="Reference images">
        {refs.map((r) => (
          <li key={r.id} className="flex h-7 items-center gap-1.5 rounded-lg border border-input bg-card pr-0.5 pl-0.5">
            <img src={r.preview} alt="" className="h-6 w-6 rounded-md bg-artboard object-cover" />
            <label className="flex flex-col">
              <span className="sr-only">What should the AI take from this reference?</span>
              <select
                value={r.role}
                disabled={disabled}
                onChange={(e) => setRole(r.id, e.target.value as ReferenceRole)}
                className="h-6 max-w-[150px] rounded-md bg-transparent pr-1 text-[12px] font-medium outline-none"
                aria-label="Use this reference for"
              >
                {REFERENCE_ROLES.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.label} · {role.hint}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" disabled={disabled} onClick={() => remove(r.id)} aria-label="Remove reference" className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </li>
        ))}
        {!full && (
          <li>
            <label
              {...drop.handlers}
              className={cn(
                "inline-flex h-7 cursor-pointer items-center gap-2 rounded-lg border border-input bg-card px-3 text-[13px] font-medium text-foreground hover:bg-secondary",
                drop.dragging && "border-primary bg-primary/10",
                disabled && "pointer-events-none opacity-50",
              )}
            >
              <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />
              Reference
              <input
                type="file"
                accept="image/*"
                multiple
                disabled={disabled}
                aria-label="Add reference images"
                className="sr-only"
                onChange={(e) => { void add(Array.from(e.target.files ?? [])); e.target.value = ""; }}
              />
            </label>
          </li>
        )}
      </ul>
      
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

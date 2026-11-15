// "My references": references the designer saved (♥ in the References panel), kept on this device
// in IndexedDB like the rest of their work (persist.ts; nothing uploaded except, small, with each
// reference search). The search offers them to the picker first, so their taste leads.
import { loadSaved, saveSaved } from "@/lib/persist";
import { imagePixels } from "@/lib/concept-client";
import type { LibraryItem } from "@/lib/reference-search";
import type { ReferenceRole } from "@/lib/brief";

const KEY = "library";
export const LIBRARY_MAX = 24;
/** How many saved references go with each search (newest first). */
export const LIBRARY_PER_SEARCH = 8;

let cache: LibraryItem[] | null = null;
const listeners = new Set<(items: LibraryItem[]) => void>();
const emit = (items: LibraryItem[]) => listeners.forEach((l) => l(items));

export async function loadLibrary(): Promise<LibraryItem[]> {
  if (cache) return cache;
  const raw = await loadSaved<LibraryItem[]>(KEY);
  cache = Array.isArray(raw) ? raw.filter((x) => x && typeof x.id === "string" && typeof x.image === "string") : [];
  return cache;
}

async function store(items: LibraryItem[]) {
  cache = items;
  emit(items);
  await saveSaved(KEY, items);
}

/** A small JPEG of the reference, enough for the picker (low detail) and the panel. */
async function small(image: string) {
  const { canvas } = await imagePixels(image, 256);
  return canvas.toDataURL("image/jpeg", 0.85);
}

export async function saveToLibrary(ref: { key: string; image: string; role: ReferenceRole; description: string }) {
  const items = await loadLibrary();
  if (items.some((x) => x.id === ref.key)) return;
  const item: LibraryItem = { id: ref.key, image: await small(ref.image), role: ref.role, note: ref.description.slice(0, 200) };
  await store([item, ...items].slice(0, LIBRARY_MAX));
}

export async function removeFromLibrary(key: string) {
  await store((await loadLibrary()).filter((x) => x.id !== key));
}

export async function clearLibrary() {
  await store([]);
}

export function onLibraryChange(fn: (items: LibraryItem[]) => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

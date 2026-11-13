import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppHeader, type View } from "@/components/app/app-header";
import { ResultWorkspace } from "@/components/app/result-workspace";
import { BriefBatch } from "@/components/brief-batch";
import { CreateLogo } from "@/components/create-logo";
import { ImportLogo } from "@/components/import-logo";
import type { LogoBrief } from "@/lib/brief";
import type { ConceptState } from "@/lib/concept-pipeline";
import { conceptName, traceColorConcept, traceConcept, type TracedConcept } from "@/lib/concept-result";
import { addRecent } from "@/lib/recent";
import type { LogoResult } from "@/lib/result-model";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "LOGOO — logo concepts from a brief" },
      { name: "description", content: "Write or paste a brief and get four checked logo concepts, ready as SVG, Illustrator (.ai) and PNG." },
      { property: "og:title", content: "LOGOO — logo concepts from a brief" },
      { property: "og:description", content: "Describe your brand and get four checked logo concepts, ready as SVG, Illustrator and PNG." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

type Opened = { traced: TracedConcept; shown: LogoResult; from: View };

function Index() {
  const [view, setView] = useState<View>("create");
  const [opened, setOpened] = useState<Opened | null>(null);
  const [opening, setOpening] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [colorBusy, setColorBusy] = useState(false);

  /** A passed concept → exact trace → the result workspace (colour first when it relies on colour). */
  async function open(c: ConceptState, brief: LogoBrief, from: View) {
    if (!c.image || opening) return;
    setOpening(true);
    setNotice(null);
    try {
      const traced = await traceConcept(c.image, conceptName(brief.brandName, c.index), c.provider);
      const shown = traced.color ?? traced.mono;
      setOpened({ traced, shown, from });
      addRecent({ name: traced.name, mode: "trace", svg: shown.svg });
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "That logo couldn't be traced.");
    } finally {
      setOpening(false);
    }
  }

  async function chooseVariant(v: "mono" | "color") {
    if (!opened || colorBusy) return;
    const t = opened.traced;
    if (v === "mono") { setOpened({ ...opened, shown: t.mono }); return; }
    if (t.color) { setOpened({ ...opened, shown: t.color }); return; }
    setColorBusy(true);
    try {
      await new Promise((r) => setTimeout(r, 30));
      const color = await traceColorConcept(t.src, t.name, t.detail);
      setOpened((o) => (o && o.traced === t ? { ...o, traced: { ...t, color }, shown: color } : o));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "The colour version could not be made.");
    } finally {
      setColorBusy(false);
    }
  }

  return (
    <>
      {view === "import" && <ImportLogo nav={<AppHeader view={view} onView={setView} />} />}
      {opened && view !== "import" && (
        <ResultWorkspace
          result={opened.shown}
          versions={[]}
          onPickVersion={() => {}}
          onNew={() => { setView(opened.from); setOpened(null); }}
          notice={notice}
          onVariant={(v) => void chooseVariant(v)}
          colorBusy={colorBusy}
        />
      )}
      {/* Kept mounted while a result is open, so running jobs and their concepts carry on. */}
      <div className={cn("flex min-h-dvh flex-col bg-dots", (opened || view === "import") && "hidden")}>
        <AppHeader view={view} onView={setView} />
        <div className="app-panel mx-2 mt-1 mb-2 flex flex-1 flex-col pt-2 sm:mx-3 sm:mb-3">
        {opening && (
          <p role="status" className="mx-auto mb-2 rounded-xl bg-card px-4 py-2 text-sm text-subtle shadow-sm">Tracing your logo into a clean vector…</p>
        )}
        {notice && !opened && <p role="alert" className="mx-auto mb-2 px-4 text-sm text-destructive">{notice}</p>}
        <div className={cn("flex flex-1 flex-col", view !== "create" && "hidden")}>
          <CreateLogo onOpen={(c, b) => void open(c, b, "create")} />
        </div>
        <div className={cn("flex flex-1 flex-col", view !== "batch" && "hidden")}>
          <BriefBatch onOpen={(c, b) => void open(c, b, "batch")} />
        </div>
        </div>
      </div>
    </>
  );
}

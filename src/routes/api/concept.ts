import { createFileRoute } from "@tanstack/react-router";
import { normalizeBrief, REFERENCE_ROLE_IDS, type ReferenceNote } from "@/lib/brief";
import { buildConceptPrompt, buildFixPrompt } from "@/lib/concept-prompt";
import { editImage, generateImage, imageSettings } from "@/lib/image-gateway.server";
import { grokEdit, grokGenerate } from "@/lib/own-providers.server";
import { isFile } from "@/lib/openai-text.server";

/** Reference notes from the client, kept to known roles and bounded text. */
function readReferences(raw: string): ReferenceNote[] {
  try {
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    return list
      .filter((r): r is ReferenceNote => Boolean(r) && (REFERENCE_ROLE_IDS as string[]).includes((r as ReferenceNote).role) && typeof (r as ReferenceNote).description === "string")
      .slice(0, 4)
      .map((r) => ({ role: r.role, description: r.description.slice(0, 600) }));
  } catch {
    return [];
  }
}

// One logo concept from a brief, or a local fix of a draft that failed review.
// The prompt is always built here from the brief (shared prompt builder), never sent raw.
// Always answers with an SSE image stream so the browser handles both providers the same way.
export const Route = createFileRoute("/api/concept")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const form = await request.formData();
        const provider = String(form.get("provider") ?? "openai");
        if (provider !== "openai" && provider !== "grok") return new Response("Invalid provider", { status: 400 });
        let brief;
        try {
          brief = normalizeBrief(JSON.parse(String(form.get("brief") ?? "{}")));
        } catch {
          return new Response("Invalid brief", { status: 400 });
        }
        if (!brief.summary && !brief.brandName) return new Response("The brief is empty", { status: 400 });
        const references = readReferences(String(form.get("references") ?? "[]"));
        const index = Math.max(0, Math.min(3, Number(form.get("index") ?? 0) || 0));
        const draft = form.get("image");
        let issues: string[] = [];
        try {
          const parsed = JSON.parse(String(form.get("issues") ?? "[]")) as unknown;
          if (Array.isArray(parsed)) issues = parsed.filter((i): i is string => typeof i === "string").map((i) => i.slice(0, 300)).slice(0, 10);
        } catch {
          return new Response("Invalid issues", { status: 400 });
        }
        const fixing = isFile(draft);
        if (fixing && !issues.length) return new Response("Nothing to fix", { status: 400 });
        const prompt = fixing ? buildFixPrompt(brief, issues) : buildConceptPrompt(brief, references, index);
        const streaming = form.get("stream") !== "false";

        if (provider === "grok") return fixing ? grokEdit(prompt, [draft], request.signal) : grokGenerate(prompt, request.signal);

        const apiKey = process.env["OPENAI_API_KEY"];
        if (!apiKey) return new Response("Missing OpenAI key", { status: 500 });
        let upstream: Response;
        if (fixing) {
          const edit = new FormData();
          edit.set("prompt", prompt);
          edit.set("image", draft);
          edit.set("quality", "high");
          edit.set("size", "1024x1024");
          edit.set("stream", String(streaming));
          upstream = await editImage({ ...imageSettings, apiKey }, edit, request.signal);
        } else {
          upstream = await generateImage({ ...imageSettings, apiKey }, prompt, streaming, request.signal, { size: "1024x1024", quality: "high" });
        }
        if (!upstream.ok) {
          const t = await upstream.text().catch(() => "");
          console.error(`OpenAI image failed [${upstream.status}]: ${t}`);
          return new Response(upstream.status === 429 ? "The AI is busy right now (rate limit)." : `OpenAI image failed: ${upstream.status}`, { status: upstream.status });
        }
        return new Response(upstream.body, {
          status: upstream.status,
          headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json", "Cache-Control": "no-cache" },
        });
      },
    },
  },
});

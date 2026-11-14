import { createFileRoute } from "@tanstack/react-router";
import { normalizeBrief, REFERENCE_ROLE_IDS, type ReferenceNote, type ReferenceRole } from "@/lib/brief";
import { buildConceptPrompt, buildFixPrompt, buildRecreatePrompt } from "@/lib/concept-prompt";
import { normalizePlan } from "@/lib/concept-plan";
import { editImage, generateImage, imageSettings } from "@/lib/image-gateway.server";
import { grokEdit, grokGenerate } from "@/lib/own-providers.server";
import { classifyOpenAIError, isFile, UPSTREAM_MESSAGES } from "@/lib/openai-text.server";

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
        const index = Math.max(0, Math.min(11, Number(form.get("index") ?? 0) || 0));
        const draft = form.get("image");
        let issues: string[] = [];
        try {
          const parsed = JSON.parse(String(form.get("issues") ?? "[]")) as unknown;
          if (Array.isArray(parsed)) issues = parsed.filter((i): i is string => typeof i === "string").map((i) => i.slice(0, 300)).slice(0, 10);
        } catch {
          return new Response("Invalid issues", { status: 400 });
        }
        const recreate = form.get("recreate");
        const recreating = isFile(draft) && typeof recreate === "string";
        const fixing = isFile(draft);
        if (fixing && !recreating && !issues.length) return new Response("Nothing to fix", { status: 400 });
        // The planned idea for this concept: structured, bounded fields (never a raw prompt).
        let plan = null;
        try {
          plan = normalizePlan(JSON.parse(String(form.get("plan") ?? "null")));
        } catch {
          return new Response("Invalid plan", { status: 400 });
        }
        // Reference pictures the image model looks at (OpenAI only, new drawings only), each with
        // the one role it may lend. Checked by shape, type and size; at most four.
        const pictures: { file: File; role: ReferenceRole }[] = [];
        for (let i = 0; i < 4 && !fixing && provider === "openai"; i++) {
          const file = form.get(`refImage${i}`);
          const role = String(form.get(`refRole${i}`) ?? "");
          if (!isFile(file)) continue;
          if (!(REFERENCE_ROLE_IDS as string[]).includes(role)) return new Response("Invalid reference role", { status: 400 });
          if (file.size > 4_000_000 || !/^image\/(png|jpeg|webp)$/.test(file.type)) return new Response("Reference pictures must be PNG, JPG or WebP under 4 MB", { status: 400 });
          pictures.push({ file, role: role as ReferenceRole });
        }
        const prompt = recreating ? buildRecreatePrompt(brief, recreate) : fixing ? buildFixPrompt(brief, issues) : buildConceptPrompt(brief, references, index, plan, pictures.map((p) => p.role));
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
        } else if (pictures.length) {
          // With reference pictures: the edit endpoint takes them as input images (like ChatGPT),
          // and the prompt says to draw a new logo, not edit them.
          const withRefs = new FormData();
          withRefs.set("prompt", prompt);
          for (const p of pictures) withRefs.append("image[]", p.file);
          withRefs.set("quality", "high");
          withRefs.set("size", "1024x1024");
          withRefs.set("stream", String(streaming));
          upstream = await editImage({ ...imageSettings, apiKey }, withRefs, request.signal);
        } else {
          upstream = await generateImage({ ...imageSettings, apiKey }, prompt, streaming, request.signal, { size: "1024x1024", quality: "high" });
        }
        if (!upstream.ok) {
          const t = await upstream.text().catch(() => "");
          const kind = classifyOpenAIError(upstream.status, t);
          console.error(`OpenAI image failed [${upstream.status} ${kind}]: ${t}`);
          // Out of credit / bad key: a clear message and a status the client won't retry (402/401).
          // Rate limits stay 429, which the concept loop retries with backoff.
          if (kind !== "other") return new Response(UPSTREAM_MESSAGES[kind].message, { status: UPSTREAM_MESSAGES[kind].status });
          return new Response(`OpenAI image failed: ${upstream.status}`, { status: upstream.status });
        }
        return new Response(upstream.body, {
          status: upstream.status,
          headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json", "Cache-Control": "no-cache" },
        });
      },
    },
  },
});

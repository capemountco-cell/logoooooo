import { createFileRoute } from "@tanstack/react-router";
import { normalizeBrief, REFERENCE_ROLE_IDS, type ReferenceNote } from "@/lib/brief";
import { buildReviewPrompt, checklist, crossCheckSpelling, expectedText, parseReview, REVIEW_SCHEMA } from "@/lib/concept-prompt";
import { errorResponse, fileToDataUrl, isFile, openaiJson } from "@/lib/openai-text.server";

// The AI half of the quality check: a vision model grades one concept against the brief and
// returns a pass/fail per box with a concrete fix. Spelling is double-checked against what it read.
export const Route = createFileRoute("/api/review")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const form = await request.formData();
        const image = form.get("image");
        if (!isFile(image)) return new Response("An image is required", { status: 400 });
        let brief, references: ReferenceNote[];
        try {
          brief = normalizeBrief(JSON.parse(String(form.get("brief") ?? "{}")));
          const raw = JSON.parse(String(form.get("references") ?? "[]")) as unknown;
          references = Array.isArray(raw) ? (raw as ReferenceNote[]).filter((r) => (REFERENCE_ROLE_IDS as string[]).includes(r?.role) && typeof r.description === "string").slice(0, 4) : [];
        } catch {
          return new Response("Invalid brief", { status: 400 });
        }
        const checks = checklist(brief, references.length > 0);
        try {
          const raw = await openaiJson({
            instructions: buildReviewPrompt(brief, references, checks),
            content: [{ type: "input_image", image_url: await fileToDataUrl(image), detail: "high" }],
            schema: REVIEW_SCHEMA,
            name: "logo_review",
            effort: "low",
            signal: request.signal,
          });
          const { results, textSeen } = parseReview(raw, checks);
          return Response.json({ results: crossCheckSpelling(results, textSeen, expectedText(brief)), textSeen });
        } catch (e) {
          return errorResponse(e, "The quality check couldn't run. Please try again.");
        }
      },
    },
  },
});

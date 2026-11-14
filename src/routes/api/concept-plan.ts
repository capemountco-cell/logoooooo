import { createFileRoute } from "@tanstack/react-router";
import { normalizeBrief, REFERENCE_ROLE_IDS, type ReferenceNote } from "@/lib/brief";
import { PLAN_INSTRUCTIONS, PLAN_SCHEMA, planInput, readPlans } from "@/lib/concept-plan";
import { errorResponse, openaiJson } from "@/lib/openai-text.server";

// Plans one round: a genuinely different idea per concept (concept-plan.ts), by the cheap text
// model with structured output. The client falls back to fallbackPlans when this fails.
export const Route = createFileRoute("/api/concept-plan")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { brief?: unknown; references?: unknown; count?: unknown; tried?: unknown };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return new Response("Invalid request", { status: 400 });
        }
        const brief = normalizeBrief(body.brief);
        if (!brief.summary && !brief.brandName) return new Response("The brief is empty", { status: 400 });
        const count = Math.max(1, Math.min(4, Number(body.count) || 3));
        const references: ReferenceNote[] = (Array.isArray(body.references) ? body.references : [])
          .filter((r): r is ReferenceNote => Boolean(r) && (REFERENCE_ROLE_IDS as string[]).includes((r as ReferenceNote).role) && typeof (r as ReferenceNote).description === "string")
          .slice(0, 4)
          .map((r) => ({ role: r.role, description: r.description.slice(0, 600) }));
        const tried = (Array.isArray(body.tried) ? body.tried : []).filter((t): t is string => typeof t === "string").map((t) => t.slice(0, 200)).slice(0, 12);
        try {
          const raw = await openaiJson({
            instructions: PLAN_INSTRUCTIONS,
            content: [{ type: "input_text", text: planInput(brief, references, count, tried) }],
            schema: PLAN_SCHEMA,
            name: "concept_plans",
            effort: "low",
            signal: request.signal,
          });
          return Response.json({ plans: readPlans(raw, brief, count) });
        } catch (e) {
          return errorResponse(e, "Couldn't plan the concepts.");
        }
      },
    },
  },
});

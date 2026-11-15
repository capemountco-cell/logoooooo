import { createFileRoute } from "@tanstack/react-router";
import { normalizeBrief, REFERENCE_ROLE_IDS, type ReferenceRole } from "@/lib/brief";
import { errorResponse } from "@/lib/openai-text.server";
import { findReferences, readLibrary } from "@/lib/reference-search.server";

// Finds reference images for a brief automatically: search, AI pick per role, role-limited text.
export const Route = createFileRoute("/api/references")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { brief?: unknown; exclude?: unknown; roles?: unknown; library?: unknown };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return new Response("Invalid request", { status: 400 });
        }
        const brief = normalizeBrief(body.brief);
        if (!brief.summary && !brief.brandName && !brief.industry) return new Response("The brief is empty", { status: 400 });
        const exclude = Array.isArray(body.exclude) ? body.exclude.filter((x): x is string => typeof x === "string").slice(0, 200) : [];
        const roles = Array.isArray(body.roles) ? body.roles.filter((r): r is ReferenceRole => (REFERENCE_ROLE_IDS as unknown[]).includes(r)) : undefined;
        try {
          return Response.json(await findReferences(brief, { exclude, ...(roles ? { roles } : {}), library: readLibrary(body.library), signal: request.signal }));
        } catch (e) {
          return errorResponse(e, "Couldn't find references right now.");
        }
      },
    },
  },
});

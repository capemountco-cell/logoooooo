import { createFileRoute } from "@tanstack/react-router";
import { cleanLink } from "@/lib/link-reference";
import { LinkError, readLink } from "@/lib/link-reference.server";

// A link from a brief → the public page's title, description, short text and up to four images.
// Nothing is stored; private and local addresses are refused (link-reference.server.ts).
export const Route = createFileRoute("/api/link-reference")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const form = await request.formData();
        const url = cleanLink(String(form.get("url") ?? "").slice(0, 2000));
        if (!url) return new Response("That doesn't look like a web link.", { status: 400 });
        try {
          return Response.json(await readLink(url, request.signal));
        } catch (e) {
          if (e instanceof LinkError) return new Response(e.message, { status: 422 });
          if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) return new Response("The page took too long to open.", { status: 504 });
          console.error("Link reference failed", e);
          return new Response("Couldn't open that page.", { status: 502 });
        }
      },
    },
  },
});

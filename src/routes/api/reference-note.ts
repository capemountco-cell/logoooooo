import { createFileRoute } from "@tanstack/react-router";
import { REFERENCE_ROLE_IDS, type ReferenceRole } from "@/lib/brief";
import { errorResponse, fileToDataUrl, isFile } from "@/lib/openai-text.server";
import { describeReference, fetchThumb } from "@/lib/reference-search.server";

// Describes one reference for one role (used when the user swaps, re-roles or uploads a reference
// in the review panel). The image is an uploaded file or a search thumbnail on an allowlisted host.
export const Route = createFileRoute("/api/reference-note")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const form = await request.formData();
        const role = String(form.get("role") ?? "");
        if (!(REFERENCE_ROLE_IDS as string[]).includes(role)) return new Response("Invalid reference role", { status: 400 });
        const file = form.get("image");
        const url = String(form.get("url") ?? "");
        try {
          let image: string;
          if (isFile(file)) {
            if (file.size > 8_000_000 || !/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return new Response("Use a PNG, JPG, WebP or GIF under 8 MB", { status: 400 });
            image = await fileToDataUrl(file);
          } else if (url) {
            image = await fetchThumb(url, request.signal);
          } else {
            return new Response("An image is required", { status: 400 });
          }
          const description = await describeReference(image, role as ReferenceRole, request.signal);
          if (!description) return new Response("Couldn't read that reference", { status: 502 });
          return Response.json({ description, image });
        } catch (e) {
          if (e instanceof Error && /host not allowed|unavailable|too large/i.test(e.message)) return new Response(e.message, { status: 400 });
          return errorResponse(e, "Couldn't read that reference.");
        }
      },
    },
  },
});

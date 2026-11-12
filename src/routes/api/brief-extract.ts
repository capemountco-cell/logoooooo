import { createFileRoute } from "@tanstack/react-router";
import { EXTRACT_INSTRUCTIONS, MAX_BRIEF_PDF, TILE } from "@/lib/brief-extract";
import { errorResponse, fileToDataUrl, isFile, openaiText, type ContentPart } from "@/lib/openai-text.server";

// Reads a brief from an uploaded screenshot (sent as ordered sections) or a PDF, and returns it as
// plain text for the composer, where the normal brief cleanup takes over.
export const Route = createFileRoute("/api/brief-extract")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const form = await request.formData();
        const files = form.getAll("file").filter(isFile);
        if (!files.length) return new Response("Add a screenshot or document of the brief.", { status: 400 });
        const images = files.filter((f) => /^image\/(png|jpeg|webp|gif)$/.test(f.type));
        const pdf = files.find((f) => f.type === "application/pdf");
        if (images.length > TILE.max) return new Response("Too many sections in one brief.", { status: 400 });
        if (images.some((f) => f.size > 6_000_000)) return new Response("A section is too large.", { status: 400 });
        if (pdf && pdf.size > MAX_BRIEF_PDF) return new Response("That PDF is over 15 MB.", { status: 400 });
        if (!images.length && !pdf) return new Response("Use a PNG, JPG, WebP, GIF or PDF.", { status: 400 });
        try {
          const content: ContentPart[] = pdf
            ? [{ type: "input_file", filename: "brief.pdf", file_data: await fileToDataUrl(pdf) }]
            : await Promise.all(images.map(async (f) => ({ type: "input_image" as const, image_url: await fileToDataUrl(f), detail: "high" as const })));
          const text = await openaiText({ instructions: EXTRACT_INSTRUCTIONS, content, effort: "low", signal: request.signal });
          if (!text.trim()) return new Response("Couldn't find a brief in that file.", { status: 422 });
          return Response.json({ text: text.trim().slice(0, 8000) });
        } catch (e) {
          return errorResponse(e, "Couldn't read that brief. Try a clearer screenshot.");
        }
      },
    },
  },
});

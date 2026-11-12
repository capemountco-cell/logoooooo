import { createFileRoute } from "@tanstack/react-router";
import { BRIEF_INSTRUCTIONS, BRIEF_SCHEMA, briefInput, MAX_REFERENCES, normalizeBrief, referenceInstructions, REFERENCE_ROLE_IDS, type ReferenceNote, type ReferenceRole } from "@/lib/brief";
import { cleanPastedBrief } from "@/lib/clean-paste";
import { errorResponse, fileToDataUrl, isFile, openaiJson, openaiText } from "@/lib/openai-text.server";

// Messy notes (+ reference images with a role each) → a clean, structured logo brief.
// Each reference is read for its role only, so e.g. a typography reference never leaks its symbol.
export const Route = createFileRoute("/api/brief")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const form = await request.formData();
        // Pasted web pages lose their menus, footers, links and legal text before the AI reads them.
        const notes = cleanPastedBrief(String(form.get("notes") ?? "").slice(0, 60_000)).text;
        if (notes.length < 2) return new Response("Describe the logo you need first.", { status: 400 });
        const refs: { role: ReferenceRole; file: File | null; palette: string }[] = [];
        for (let i = 0; i < MAX_REFERENCES; i++) {
          const role = String(form.get(`role${i}`) ?? "");
          if (!role) continue;
          if (!(REFERENCE_ROLE_IDS as string[]).includes(role)) return new Response("Invalid reference role", { status: 400 });
          const file = form.get(`ref${i}`);
          refs.push({ role: role as ReferenceRole, file: isFile(file) ? file : null, palette: String(form.get(`palette${i}`) ?? "").slice(0, 200) });
        }
        try {
          const references: ReferenceNote[] = await Promise.all(
            refs.map(async (r): Promise<ReferenceNote> => {
              // Colours are measured exactly from the pixels on the device; no AI guessing.
              if (r.role === "colour" && r.palette) return { role: r.role, description: `Use this palette: ${r.palette}.` };
              if (!r.file) throw new Error("A reference image is missing");
              const description = await openaiText({
                instructions: referenceInstructions(r.role),
                content: [{ type: "input_image", image_url: await fileToDataUrl(r.file), detail: r.role === "typography" || r.role === "style" ? "high" : "low" }],
                signal: request.signal,
              });
              return { role: r.role, description: description.slice(0, 600) };
            }),
          );
          const raw = await openaiJson({
            instructions: BRIEF_INSTRUCTIONS,
            content: [{ type: "input_text", text: briefInput(notes, references) }],
            schema: BRIEF_SCHEMA,
            name: "logo_brief",
            signal: request.signal,
          });
          return Response.json({ brief: normalizeBrief(raw), references });
        } catch (e) {
          return errorResponse(e, "Couldn't read your brief. Please try again.");
        }
      },
    },
  },
});

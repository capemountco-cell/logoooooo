// OpenAI Responses API helpers (server only), on the user's own OPENAI_API_KEY.
// Brief cleanup, reference reading and concept review all use the cheapest model.
export const TEXT_MODEL = "gpt-5-nano";

export type ContentPart =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string; detail: "low" | "high" | "auto" };

type Options = {
  instructions: string;
  content: ContentPart[];
  effort?: "minimal" | "low" | "medium";
  signal?: AbortSignal | undefined;
};

export class UpstreamError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function respond(body: Record<string, unknown>, signal?: AbortSignal) {
  const key = process.env["OPENAI_API_KEY"];
  if (!key) throw new UpstreamError("Missing OpenAI key", 500);
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: signal ?? null,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.error(`OpenAI ${String(body["model"])} failed [${res.status}]: ${t}`);
    throw new UpstreamError(`OpenAI request failed (${res.status})`, res.status);
  }
  const json = (await res.json()) as { output?: { type: string; content?: { type: string; text?: string }[] }[] };
  return (json.output ?? [])
    .flatMap((i) => (i.type === "message" ? (i.content ?? []) : []))
    .map((c) => (c.type === "output_text" ? (c.text ?? "") : ""))
    .join("")
    .trim();
}

/** Plain text answer. */
export function openaiText({ instructions, content, effort = "minimal", signal }: Options) {
  return respond({ model: TEXT_MODEL, instructions, input: [{ role: "user", content }], reasoning: { effort } }, signal);
}

/** JSON answer that follows `schema` exactly (structured outputs). */
export async function openaiJson({ instructions, content, effort = "minimal", signal, schema, name }: Options & { schema: object; name: string }): Promise<unknown> {
  const text = await respond(
    {
      model: TEXT_MODEL,
      instructions,
      input: [{ role: "user", content }],
      reasoning: { effort },
      text: { format: { type: "json_schema", name, schema, strict: true } },
    },
    signal,
  );
  try {
    return JSON.parse(text);
  } catch {
    throw new UpstreamError("The AI returned an unreadable answer", 502);
  }
}

export async function fileToDataUrl(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${file.type || "image/png"};base64,${btoa(bin)}`;
}

/** Turns a failure into a short response for the browser (the status is kept for retry decisions). */
export function errorResponse(e: unknown, fallback: string) {
  const status = e instanceof UpstreamError ? e.status : 500;
  const message = status === 429 ? "The AI is busy right now (rate limit). Retrying shortly." : e instanceof UpstreamError && status === 500 ? e.message : fallback;
  return new Response(message, { status: status >= 400 ? status : 502 });
}

/** An uploaded file part. Checked by shape, not `instanceof File`, which differs between runtimes. */
export function isFile(v: unknown): v is File {
  return typeof v === "object" && v !== null && typeof (v as Blob).arrayBuffer === "function" && typeof (v as File).name === "string";
}

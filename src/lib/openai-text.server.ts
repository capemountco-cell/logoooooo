// OpenAI Responses API helpers (server only), on the user's own OPENAI_API_KEY.
// Brief cleanup, reference reading and concept review all use the cheapest model.
export const TEXT_MODEL = "gpt-5-nano";

export type ContentPart =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string; detail: "low" | "high" | "auto" }
  | { type: "input_file"; filename: string; file_data: string };

type Options = {
  instructions: string;
  content: ContentPart[];
  effort?: "minimal" | "low" | "medium";
  signal?: AbortSignal | undefined;
};

export type UpstreamKind = "quota" | "rate" | "auth" | "other";

export class UpstreamError extends Error {
  constructor(message: string, readonly status: number, readonly kind: UpstreamKind = "other") {
    super(message);
  }
}

/**
 * What an OpenAI error really means. OpenAI returns 429 both for rate limits and for an account
 * with no credit or billing ("insufficient_quota"), so the body's code decides.
 */
export function classifyOpenAIError(status: number, body: string): UpstreamKind {
  if (/insufficient_quota|billing_hard_limit|billing_not_active|exceeded your current quota/i.test(body)) return "quota";
  if (status === 401 || status === 403 || /invalid_api_key|incorrect api key/i.test(body)) return "auth";
  if (status === 429) return "rate";
  return "other";
}

/** Plain messages for each kind, shown to the user as they are. */
export const UPSTREAM_MESSAGES: Record<Exclude<UpstreamKind, "other">, { status: number; message: string }> = {
  quota: { status: 402, message: "Your OpenAI account is out of credit or has no billing set up, so OpenAI refused the request. Add credit at platform.openai.com → Settings → Billing, then try again." },
  rate: { status: 429, message: "OpenAI is rate-limiting this API key (too many requests for its usage tier). Wait a minute and try again — new OpenAI accounts have low limits until they have some paid usage." },
  auth: { status: 401, message: "OpenAI rejected the API key. Check OPENAI_API_KEY in your Lovable project's secrets." },
};

/** Wait from a Retry-After header (seconds or ms variants), else exponential backoff. */
function retryDelay(res: Response, attempt: number) {
  const ms = Number(res.headers.get("retry-after-ms"));
  if (Number.isFinite(ms) && ms > 0) return Math.min(ms, 20_000);
  const s = Number(res.headers.get("retry-after"));
  if (Number.isFinite(s) && s > 0) return Math.min(s * 1000, 20_000);
  return 1500 * 2 ** attempt;
}

export const RATE_RETRIES = 3;
export const sleepMs = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function respond(body: Record<string, unknown>, signal?: AbortSignal) {
  const key = process.env["OPENAI_API_KEY"];
  if (!key) throw new UpstreamError("Missing OpenAI key", 500);
  let res: Response;
  // Rate limits are retried here (honouring Retry-After); out-of-credit and bad keys never are.
  for (let attempt = 0; ; attempt++) {
    res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: signal ?? null,
    });
    if (res.ok) break;
    const t = await res.text().catch(() => "");
    const kind = classifyOpenAIError(res.status, t);
    console.error(`OpenAI ${String(body["model"])} failed [${res.status} ${kind}]: ${t}`);
    if (kind === "rate" && attempt < RATE_RETRIES) {
      await sleepMs(retryDelay(res, attempt));
      signal?.throwIfAborted();
      continue;
    }
    throw new UpstreamError(`OpenAI request failed (${res.status})`, res.status, kind);
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

export function bytesToDataUrl(bytes: Uint8Array, type: string) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${type || "image/png"};base64,${btoa(bin)}`;
}

export async function fileToDataUrl(file: File) {
  return bytesToDataUrl(new Uint8Array(await file.arrayBuffer()), file.type);
}

/** Turns a failure into a short response for the browser (the status is kept for retry decisions). */
export function errorResponse(e: unknown, fallback: string) {
  if (e instanceof UpstreamError && e.kind !== "other") {
    const m = UPSTREAM_MESSAGES[e.kind];
    return new Response(m.message, { status: m.status });
  }
  const status = e instanceof UpstreamError ? e.status : 500;
  const message = e instanceof UpstreamError && status === 500 ? e.message : fallback;
  return new Response(message, { status: status >= 400 ? status : 502 });
}

/** An uploaded file part. Checked by shape, not `instanceof File`, which differs between runtimes. */
export function isFile(v: unknown): v is File {
  return typeof v === "object" && v !== null && typeof (v as Blob).arrayBuffer === "function" && typeof (v as File).name === "string";
}

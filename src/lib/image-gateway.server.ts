// OpenAI image calls (server only). Grok has its own helpers in own-providers.server.ts.
export type ImageConfig = {
  baseURL: string;
  apiKey: string;
  model: string;
};

/** Text-to-image. Streams partial images (SSE) when `stream` is true. */
export function generateImage(config: ImageConfig, prompt: string, stream = true, signal?: AbortSignal, extra: Record<string, unknown> = {}) {
  return fetch(`${config.baseURL}/v1/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: config.model, prompt, ...extra, ...(stream ? { stream: true, partial_images: 1 } : {}) }),
    signal: signal ?? null,
  });
}

/** Image edit: the form carries the prompt and image(s); streams unless form.stream is "false". */
export function editImage(config: ImageConfig, form: FormData, signal?: AbortSignal) {
  const streaming = form.get("stream") !== "false";
  form.set("model", config.model);
  if (streaming) {
    form.set("stream", "true");
    if (!form.has("partial_images")) form.set("partial_images", "1");
  } else {
    form.delete("stream");
    form.delete("partial_images");
  }
  return fetch(`${config.baseURL}/v1/images/edits`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}` },
    body: form,
    signal: signal ?? null,
  });
}

export const imageSettings: Omit<ImageConfig, "apiKey"> = { baseURL: "https://api.openai.com", model: "gpt-image-2" };

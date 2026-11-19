// Pure cloud-provider logic (no DOM, no SDK): tool mapping,
// SSE parsing, image blocks and token estimates for the opt-in BYOK cloud models.

/** Anthropic native tool definitions from the session's toolSchemas() output (strict schemas, eager input streaming). */
export function anthropicToolDefinitions(schemas) {
  return schemas.map(({ function: t }) => ({
    name: t.name,
    description: t.description,
    input_schema: { ...t.parameters, additionalProperties: false },
    strict: true,
    eager_input_streaming: true,
  }));
}

/**
 * Parse an OpenAI-compatible `stream: true` SSE body into { text, toolCalls }.
 * toolCalls arguments arrive as string fragments split over chunks, keyed by index.
 * @param {ReadableStream<Uint8Array>} body
 * @param {(piece: string) => void} onText streamed text deltas
 */
export async function parseSSE(body, onText = () => {}) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const calls = new Map();
  let text = "";
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      let chunk;
      try { chunk = JSON.parse(data); } catch { continue; }
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta ?? choice.message ?? {};
      if (delta.content) { text += delta.content; onText(delta.content); }
      for (const part of delta.tool_calls ?? []) {
        const slot = calls.get(part.index) ?? { id: part.id, name: "", arguments: "" };
        if (part.id) slot.id = part.id;
        if (part.function?.name) slot.name += part.function.name;
        if (part.function?.arguments) slot.arguments += part.function.arguments;
        calls.set(part.index, slot);
      }
    }
  }
  const toolCalls = [...calls.values()].map((slot) => {
    let parsed;
    try { parsed = JSON.parse(slot.arguments || "{}"); } catch { parsed = { error: "Tool arguments were not valid JSON" }; }
    return { name: slot.name, arguments: parsed };
  });
  return { text, toolCalls };
}

/** Chunked base64 (btoa on large payloads would overflow the string argument). */
export function bytesToBase64(bytes) {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
}

/** The image part of an AI-1 attached image ({name,width,height,data,type}) as Anthropic block. */
export function anthropicImageBlock(image) {
  return { type: "image", source: { type: "base64", media_type: image.type ?? "image/png", data: bytesToBase64(image.data) } };
}

/** The image part as an OpenAI-compatible content part. */
export function openAIImagePart(image) {
  return { type: "image_url", image_url: { url: `data:${image.type ?? "image/png"};base64,${bytesToBase64(image.data)}` } };
}

/** Visible chat notice for a server-side refusal (stop_reason "refusal"). */
export function refusalNotice(stopDetails) {
  const category = stopDetails?.category ?? "unknown";
  const explanation = stopDetails?.explanation ? ` ${stopDetails.explanation}` : "";
  return `Claude refused this request (category: ${category}).${explanation} Nothing was sent to a tool.`;
}

/** Rough token estimate for the compaction budget (no API call): characters/4 plus a fixed image cost. */
export function estimateTokens(messages) {
  let chars = 0;
  for (const message of messages) {
    const content = message.content;
    if (typeof content === "string") chars += content.length;
    else if (Array.isArray(content)) for (const part of content) { if (part.type === "text") chars += part.text.length; if (part.type === "image") chars += 1400; }
    for (const call of message.tool_calls ?? []) chars += JSON.stringify(call.function.arguments).length + 60;
  }
  return Math.ceil(chars / 4);
}

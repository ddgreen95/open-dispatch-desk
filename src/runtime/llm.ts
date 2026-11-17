export interface LlmSettings {
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface LlmTurn {
  content: string;
  toolCalls: ToolCall[];
}

export interface ChatMessage {
  role: string;
  content?: string;
  tool_call_id?: string;
  tool_calls?: unknown[];
}

function clip(value: string, max = 280): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

export function redactSecret(text: string, secret: string): string {
  if (!secret) return text;
  return text.split(secret).join("[redacted]");
}

export function assertRouterUrl(baseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error("The provider URL is not a URL.");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new Error("Use an https provider URL. http is only allowed for localhost.");
  }
  if (url.username || url.password) {
    throw new Error("Put the key in the key field, not in the provider URL.");
  }
  return url;
}

interface DeltaCall {
  id?: string;
  name?: string;
  arguments: string;
}

function consumeDelta(choice: { delta?: Record<string, unknown>; message?: Record<string, unknown> }, content: { value: string }, calls: Map<number, DeltaCall>) {
  const delta = (choice.delta || choice.message || {}) as Record<string, unknown>;
  if (typeof delta.content === "string") content.value += delta.content;
  const toolCalls = delta.tool_calls;
  if (!Array.isArray(toolCalls)) return;
  for (const item of toolCalls) {
    if (!item || typeof item !== "object") continue;
    const call = item as Record<string, unknown>;
    const index = typeof call.index === "number" ? call.index : calls.size;
    const current = calls.get(index) || { arguments: "" };
    if (typeof call.id === "string" && call.id) current.id = call.id;
    const fn = call.function as Record<string, unknown> | undefined;
    if (typeof fn?.name === "string" && fn.name) current.name = fn.name;
    if (typeof fn?.arguments === "string") current.arguments += fn.arguments;
    calls.set(index, current);
  }
}

export async function completeChat(options: {
  settings: LlmSettings;
  messages: ChatMessage[];
  tools: unknown[];
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
}): Promise<LlmTurn> {
  const { settings, messages, tools, signal, onDelta } = options;
  const url = assertRouterUrl(settings.baseUrl);
  const endpoint = new URL("chat/completions", url.href.endsWith("/") ? url.href : `${url.href}/`);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${settings.apiKey}`,
  };
  if (url.hostname === "openrouter.ai") {
    headers["HTTP-Referer"] = typeof location === "undefined" ? "http://localhost" : location.origin;
    headers["X-Title"] = "Open Dispatch Desk";
  }
  let response: Response;
  try {
    response = await fetch(endpoint.href, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: settings.model,
        messages,
        tools: tools.length ? tools : undefined,
        temperature: 0.2,
        max_tokens: 800,
        stream: true,
      }),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Stopped: the model provider took too long.");
    }
    throw new Error(
      "The browser could not reach the model provider. It may be blocking this page, or the address may be wrong. Demo mode still works without a key.",
    );
  }
  if (!response.ok) {
    const body = redactSecret(await response.text(), settings.apiKey);
    throw new Error(`The model provider returned HTTP ${response.status}. ${clip(body)}`);
  }
  const contentType = response.headers.get("content-type") || "";
  const content = { value: "" };
  const calls = new Map<number, DeltaCall>();
  if (!contentType.includes("text/event-stream") || !response.body) {
    const payload = (await response.json()) as { choices?: Array<Record<string, unknown>> };
    const choice = payload.choices?.[0] || {};
    consumeDelta(choice as { message?: Record<string, unknown> }, content, calls);
  } else {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const step = await reader.read();
      if (step.done) break;
      buffer += decoder.decode(step.value, { stream: true });
      const chunks = buffer.split("\n");
      buffer = chunks.pop() || "";
      for (const line of chunks) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const payload = JSON.parse(data) as { choices?: Array<{ delta?: Record<string, unknown> }> };
          const before = content.value;
          consumeDelta(payload.choices?.[0] || {}, content, calls);
          if (content.value !== before) onDelta?.(content.value);
        } catch {
          // Ignore a partial SSE frame; the next chunk completes it.
        }
      }
    }
  }
  const toolCalls: ToolCall[] = [...calls.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, call], index) => ({
      id: call.id || `call_${index}`,
      name: call.name || "",
      arguments: call.arguments || "{}",
    }))
    .filter((call) => call.name);
  return { content: redactSecret(content.value, settings.apiKey), toolCalls };
}

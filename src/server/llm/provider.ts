export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GenOptions {
  baseUrl: string;
  apiKey?: string;
  model: string;
  temperature: number;
  maxTokens: number;
  topP: number;
  signal?: AbortSignal;
}

const MOCK_REPLY =
  "*Beni leans against the wall, twirling a strand of pink hair around one finger, those sleepy turquoise eyes sizing you up.* " +
  "Well, well. Look who wants to talk to me. *smirks* Fine — I'm listening. But make it interesting, would ya? " +
  "Boys usually mess this part up. (mock reply: connect a real model in Settings)";

async function* streamMock(): AsyncGenerator<string> {
  for (const word of MOCK_REPLY.split(/(?<= )/)) {
    yield word;
    await new Promise((r) => setTimeout(r, 8));
  }
}

/**
 * Stream a chat completion from any OpenAI-compatible endpoint
 * (KoboldCpp, LM Studio, OpenRouter, …). `baseUrl === "mock"` streams a
 * canned reply so the whole app can be exercised without a model.
 */
export async function* streamChat(messages: ChatMessage[], opts: GenOptions): AsyncGenerator<string> {
  if (opts.baseUrl === "mock") {
    yield* streamMock();
    return;
  }

  const url = opts.baseUrl.replace(/\/+$/, "") + "/chat/completions";
  const res = await fetch(url, {
    method: "POST",
    signal: opts.signal,
    headers: {
      "content-type": "application/json",
      ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {})
    },
    body: JSON.stringify({
      model: opts.model,
      messages,
      temperature: opts.temperature,
      max_tokens: opts.maxTokens,
      top_p: opts.topP,
      stream: true
    })
  });

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    throw new Error(`LLM endpoint ${res.status}: ${body.slice(0, 300) || res.statusText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const payload = t.slice(5).trim();
        if (payload === "[DONE]") return;
        try {
          const json = JSON.parse(payload);
          const delta = json.choices?.[0]?.delta?.content ?? json.choices?.[0]?.text ?? "";
          if (delta) yield delta;
        } catch {
          // partial line — ignored, next chunk completes it
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Non-streaming convenience (memory extraction, titles, …). */
export async function completeChat(messages: ChatMessage[], opts: GenOptions): Promise<string> {
  if (opts.baseUrl === "mock") {
    return '[{"text":"(mock memory) Beni met someone new in this chat and pretended not to care.","importance":2}]';
  }
  let out = "";
  for await (const tok of streamChat(messages, opts)) out += tok;
  return out;
}

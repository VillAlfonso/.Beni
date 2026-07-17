export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

export async function api<T = unknown>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${url}`, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  if (res.status === 401) {
    onUnauthorized?.();
    throw new ApiError(401, "unauthorized");
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let msg = text;
    try {
      msg = JSON.parse(text).error ?? text;
    } catch { /* plain text */ }
    throw new ApiError(res.status, msg || res.statusText);
  }
  return (await res.json()) as T;
}

export interface StreamHandlers {
  onMeta?: (meta: { retrieved: { title: string; episode: number | null; score: number }[]; memories: string[] }) => void;
  onToken: (t: string) => void;
  onDone: (d: { messageId: string }) => void;
  onError: (message: string) => void;
  signal?: AbortSignal;
}

/** POST to an SSE endpoint and dispatch its events. */
export async function stream(url: string, body: unknown, h: StreamHandlers): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`/api${url}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: h.signal
    });
  } catch (err) {
    if ((err as Error).name !== "AbortError") h.onError((err as Error).message);
    return;
  }
  if (res.status === 401) {
    onUnauthorized?.();
    h.onError("unauthorized");
    return;
  }
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    let msg = text;
    try {
      msg = JSON.parse(text).error ?? text;
    } catch { /* plain text */ }
    h.onError(msg || `HTTP ${res.status}`);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let sawTerminal = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      for (;;) {
        const idx = buf.indexOf("\n\n");
        if (idx === -1) break;
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        let event = "message";
        let data = "";
        for (const line of frame.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data += line.slice(5).trim();
        }
        if (!data) continue;
        try {
          const json = JSON.parse(data);
          if (event === "token") h.onToken(json.t ?? "");
          else if (event === "meta") h.onMeta?.(json);
          else if (event === "done") {
            sawTerminal = true;
            h.onDone(json);
          } else if (event === "error") {
            sawTerminal = true;
            h.onError(json.message ?? "unknown error");
          }
        } catch { /* ignore malformed frame */ }
      }
    }
    if (!sawTerminal) h.onError("connection closed early — partial reply was kept");
  } catch (err) {
    if ((err as Error).name !== "AbortError") h.onError((err as Error).message);
  }
}

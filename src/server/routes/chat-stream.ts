import { Router, type Response } from "express";
import type { Db } from "../db.js";
import { createMessage, pathToRoot, setHead, getMessage, type Msg } from "../core/tree.js";
import { retrieveCanon, retrieveMemories } from "../rag/retrieve.js";
import { buildSystemPrompt, buildHistory } from "../prompt/builder.js";
import { streamChat } from "../llm/provider.js";
import { getSettings } from "../settings.js";
import { maybeExtract } from "../memory/extractor.js";

interface ChatRow {
  id: string;
  mode: "isolated" | "story";
  stage_id: string;
  episode_cap: number;
  story_episode: number | null;
  head_message_id: string | null;
}

function sse(res: Response): (event: string, data: unknown) => void {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no"
  });
  return (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
}

/** Generate an assistant reply below `parent`, streaming tokens over SSE. */
async function generate(db: Db, chat: ChatRow, parent: Msg, res: Response): Promise<void> {
  const send = sse(res);
  const settings = getSettings(db);
  const path = pathToRoot(db, parent.id);

  try {
    // retrieval query: last user turn + a bit of context before it
    const lastUser = [...path].reverse().find((m) => m.role === "user");
    const prev = path.slice(-4, -1).map((m) => m.content.slice(0, 200)).join(" ");
    const query = `${lastUser?.content ?? ""} ${prev}`.slice(0, 1200);

    const [canon, memories] = await Promise.all([
      retrieveCanon(db, query, { cap: chat.episode_cap, k: 6 }),
      retrieveMemories(db, chat.id, query, { k: 6 })
    ]);

    const system = buildSystemPrompt({
      stageId: chat.stage_id,
      mode: chat.mode,
      episodeCap: chat.episode_cap,
      storyEpisode: chat.story_episode,
      canon,
      memories,
      userName: settings.userName,
      userLooks: settings.userLooks
    });

    const messages = [{ role: "system" as const, content: system }, ...buildHistory(path)];

    const abort = new AbortController();
    res.on("close", () => abort.abort());

    let full = "";
    let aborted = false;
    send("meta", {
      retrieved: canon.map((c) => ({ title: c.docTitle, episode: c.episode, score: Number(c.score.toFixed(3)) })),
      memories: memories.map((m) => m.text)
    });

    try {
      for await (const tok of streamChat(messages, {
        baseUrl: settings.llm.baseUrl,
        apiKey: settings.llm.apiKey,
        model: settings.llm.model,
        temperature: settings.gen.temperature,
        maxTokens: settings.gen.maxTokens,
        topP: settings.gen.topP,
        signal: abort.signal
      })) {
        full += tok;
        send("token", { t: tok });
      }
    } catch (err) {
      if ((err as Error).name === "AbortError" || abort.signal.aborted) aborted = true;
      else throw err;
    }

    if (!full.trim()) {
      if (aborted) {
        res.end();
        return;
      }
      throw new Error("empty reply from model");
    }

    // stopped streams keep whatever Beni already said
    const assistant = createMessage(db, {
      chatId: chat.id,
      parentId: parent.id,
      role: "assistant",
      content: full.trim(),
      meta: { model: settings.llm.model, ...(aborted ? { aborted: true } : {}) }
    });
    setHead(db, chat.id, assistant.id);
    if (!aborted) {
      send("done", { messageId: assistant.id, userMessageId: parent.role === "user" ? parent.id : null });
    }
    res.end();

    void maybeExtract(db, chat.id);
  } catch (err) {
    send("error", { message: (err as Error).message });
    res.end();
  }
}

export function chatStreamRouter(db: Db): Router {
  const r = Router();

  // send a user message and stream Beni's reply
  r.post("/chats/:id/messages", async (req, res) => {
    const chat = db.prepare("SELECT * FROM chats WHERE id=?").get(req.params.id) as ChatRow | undefined;
    if (!chat) return res.status(404).json({ error: "not found" });
    const content = String(req.body?.content ?? "").trim();
    if (!content) return res.status(400).json({ error: "empty message" });

    const user = createMessage(db, {
      chatId: chat.id,
      parentId: chat.head_message_id,
      role: "user",
      content
    });
    setHead(db, chat.id, user.id);
    await generate(db, chat, user, res);
  });

  // regenerate: new sibling branch of an existing assistant message
  r.post("/chats/:id/regenerate", async (req, res) => {
    const chat = db.prepare("SELECT * FROM chats WHERE id=?").get(req.params.id) as ChatRow | undefined;
    if (!chat) return res.status(404).json({ error: "not found" });
    const msg = getMessage(db, String(req.body?.messageId ?? ""));
    if (!msg || msg.chat_id !== chat.id || msg.role !== "assistant") {
      return res.status(400).json({ error: "messageId must be an assistant message in this chat" });
    }
    if (!msg.parent_id) return res.status(400).json({ error: "cannot regenerate the greeting" });
    const parent = getMessage(db, msg.parent_id)!;
    await generate(db, chat, parent, res);
  });

  // edit a user message → creates a sibling branch and regenerates from it
  r.post("/messages/:id/edit", async (req, res) => {
    const original = getMessage(db, req.params.id);
    if (!original || original.role !== "user") {
      return res.status(400).json({ error: "only user messages can be edited" });
    }
    const chat = db.prepare("SELECT * FROM chats WHERE id=?").get(original.chat_id) as ChatRow | undefined;
    if (!chat) return res.status(404).json({ error: "not found" });
    const content = String(req.body?.content ?? "").trim();
    if (!content) return res.status(400).json({ error: "empty message" });

    const edited = createMessage(db, {
      chatId: chat.id,
      parentId: original.parent_id,
      role: "user",
      content,
      meta: { editedFrom: original.id }
    });
    setHead(db, chat.id, edited.id);
    await generate(db, chat, edited, res);
  });

  return r;
}

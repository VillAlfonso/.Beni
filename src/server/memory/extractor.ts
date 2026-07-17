import type { Db } from "../db.js";
import { newId } from "../db.js";
import { getSettings } from "../settings.js";
import { completeChat } from "../llm/provider.js";
import { embedPassages } from "../rag/embedder.js";
import { toBlob } from "../core/vector.js";
import { pathToRoot } from "../core/tree.js";

const EVERY_N_MESSAGES = 8;
const WINDOW = 12;

/**
 * Periodically distill the recent conversation into durable episodic memories.
 * Fire-and-forget: never throws, never blocks the reply stream.
 */
export async function maybeExtract(db: Db, chatId: string): Promise<void> {
  try {
    const chat = db.prepare("SELECT head_message_id h FROM chats WHERE id=?").get(chatId) as
      | { h: string | null }
      | undefined;
    if (!chat?.h) return;

    const lastMem = db
      .prepare("SELECT MAX(created_at) t FROM memories WHERE chat_id=?")
      .get(chatId) as { t: number | null };
    const since = lastMem.t ?? 0;

    const path = pathToRoot(db, chat.h);
    const fresh = path.filter((m) => m.created_at > since);
    if (fresh.length < EVERY_N_MESSAGES) return;

    const settings = getSettings(db);
    const window = path.slice(-WINDOW);
    const excerpt = window
      .map((m) => `${m.role === "assistant" ? "Beni" : settings.userName || "User"}: ${m.content}`)
      .join("\n");

    const raw = await completeChat(
      [
        {
          role: "system",
          content:
            "You maintain the long-term memory of a roleplay character (Beni). " +
            "From the excerpt, extract up to 5 durable memories worth keeping: events that happened, facts learned about the other person, promises, secrets revealed, relationship changes. " +
            'Each memory must be a standalone past-tense sentence from Beni\'s perspective. Respond with ONLY a JSON array like [{"text":"...","importance":3}] with importance 1-5. If nothing is worth remembering, respond [].'
        },
        { role: "user", content: excerpt }
      ],
      {
        baseUrl: settings.utility.baseUrl,
        apiKey: settings.utility.apiKey,
        model: settings.utility.model,
        temperature: 0.2,
        maxTokens: 400,
        topP: 0.9
      }
    );

    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return;
    let items: { text?: unknown; importance?: unknown }[];
    try {
      items = JSON.parse(match[0]);
    } catch {
      return;
    }
    const clean = items
      .filter((it) => typeof it.text === "string" && (it.text as string).trim().length > 8)
      .slice(0, 5)
      .map((it) => ({
        text: (it.text as string).trim(),
        importance: Math.min(5, Math.max(1, Number(it.importance) || 3))
      }));
    if (clean.length === 0) return;

    const vecs = await embedPassages(clean.map((c) => c.text));
    const ins = db.prepare(
      "INSERT INTO memories(id,chat_id,text,importance,src_message_id,embedding,created_at) VALUES(?,?,?,?,?,?,?)"
    );
    const now = Date.now();
    clean.forEach((c, i) => {
      ins.run(newId(), chatId, c.text, c.importance, chat.h, toBlob(vecs[i]), now + i);
    });
  } catch (err) {
    console.warn("memory extraction skipped:", (err as Error).message);
  }
}

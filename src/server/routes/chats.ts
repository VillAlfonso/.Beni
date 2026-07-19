import { Router } from "express";
import type { Db } from "../db.js";
import { newId } from "../db.js";
import { pathToRoot, siblingsOf, forkChat, setHead, getMessage, latestLeafFrom } from "../core/tree.js";
import { loadStages, getStage, loadScenarios, loadStoryPressures, parseOpinion } from "../prompt/builder.js";
import { listJournal, sealDay, currentDay } from "../memory/journal.js";
import { retrieveCanon } from "../rag/retrieve.js";
import { getSettings } from "../settings.js";
import { completeChat } from "../llm/provider.js";

export function chatsRouter(db: Db): Router {
  const r = Router();

  r.get("/chats", (_req, res) => {
    const rows = db
      .prepare("SELECT id,title,mode,stage_id,episode_cap,story_episode,forked_from,opinion,updated_at FROM chats ORDER BY updated_at DESC")
      .all();
    res.json(rows);
  });

  r.post("/chats", (req, res) => {
    const b = req.body ?? {};
    const stages = loadStages();
    const stage = stages.find((s) => s.id === b.stageId) ?? stages[stages.length - 1];
    const mode = b.mode === "story" ? "story" : "isolated";
    const storyEpisode = mode === "story" ? Number(b.storyEpisode) || stage.cap : null;
    const cap = mode === "story" ? (storyEpisode as number) : stage.cap;
    const id = newId();
    const now = Date.now();
    const userLooks = String(b.userLooks ?? "").trim() || null;
    const opinion = JSON.stringify({ label: "a stranger", note: "", guard: 1 });
    // story mode: seed the living world state from the stage's canonical pressures
    let world: string | null = null;
    if (mode === "story") {
      const info = loadStoryPressures()[stage.id];
      world = JSON.stringify({
        divergence: "none",
        clock: { day: 1, timeOfDay: "afternoon" },
        pressures: (info?.watchers ?? []).map((w) => ({ who: w.who, level: w.start, note: "" })),
        events: [],
        beni: ""
      });
    }
    db.prepare(
      "INSERT INTO chats(id,title,mode,stage_id,episode_cap,story_episode,user_looks,opinion,world,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)"
    ).run(id, String(b.title || "New chat"), mode, stage.id, cap, storyEpisode, userLooks, opinion, world, now, now);

    // Opening scene: she's minding her own business — the player sees her first.
    // Rolled at random per chat from the stage's scenario pool; stage greeting is the fallback.
    const pool = loadScenarios()[stage.id] ?? [];
    const opening = pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : stage.greeting;
    if (opening) {
      const mid = newId();
      db.prepare(
        "INSERT INTO messages(id,chat_id,parent_id,role,content,created_at,meta) VALUES(?,?,?,?,?,?,?)"
      ).run(mid, id, null, "assistant", opening, now, JSON.stringify({ greeting: true }));
      setHead(db, id, mid);
    }
    res.json({ id });
  });

  r.get("/chats/:id", (req, res) => {
    const chat = db.prepare("SELECT * FROM chats WHERE id=?").get(req.params.id) as
      | { head_message_id: string | null }
      | undefined;
    if (!chat) return res.status(404).json({ error: "not found" });
    const path = chat.head_message_id ? pathToRoot(db, chat.head_message_id) : [];
    const withSiblings = path.map((m) => {
      const sib = siblingsOf(db, m.id);
      return { ...m, siblingCount: sib.ids.length, siblingIndex: sib.index };
    });
    const checkpoints = db
      .prepare("SELECT id,message_id,name,created_at FROM checkpoints WHERE chat_id=? ORDER BY created_at DESC")
      .all(req.params.id);
    res.json({ chat, path: withSiblings, checkpoints });
  });

  r.patch("/chats/:id", (req, res) => {
    const chat = db.prepare("SELECT * FROM chats WHERE id=?").get(req.params.id) as Record<string, unknown> | undefined;
    if (!chat) return res.status(404).json({ error: "not found" });
    const b = req.body ?? {};
    if (typeof b.title === "string" && b.title.trim()) {
      db.prepare("UPDATE chats SET title=?, updated_at=? WHERE id=?").run(b.title.trim(), Date.now(), req.params.id);
    }
    if (typeof b.stageId === "string") {
      const stage = getStage(b.stageId);
      db.prepare("UPDATE chats SET stage_id=?, episode_cap=?, updated_at=? WHERE id=?").run(
        stage.id,
        chat.mode === "story" ? chat.episode_cap : stage.cap,
        Date.now(),
        req.params.id
      );
    }
    if (b.storyEpisode !== undefined && chat.mode === "story") {
      const ep = Number(b.storyEpisode) || 1;
      db.prepare("UPDATE chats SET story_episode=?, episode_cap=?, updated_at=? WHERE id=?").run(ep, ep, Date.now(), req.params.id);
    }
    if (typeof b.userLooks === "string") {
      db.prepare("UPDATE chats SET user_looks=?, updated_at=? WHERE id=?").run(
        b.userLooks.trim() || null,
        Date.now(),
        req.params.id
      );
    }
    if (typeof b.headMessageId === "string") {
      const msg = getMessage(db, b.headMessageId);
      if (!msg || msg.chat_id !== req.params.id) return res.status(400).json({ error: "bad head" });
      setHead(db, req.params.id, latestLeafFrom(db, b.headMessageId));
    }
    res.json({ ok: true });
  });

  r.delete("/chats/:id", (req, res) => {
    db.prepare("DELETE FROM chats WHERE id=?").run(req.params.id);
    res.json({ ok: true });
  });

  r.post("/chats/:id/fork", (req, res) => {
    const b = req.body ?? {};
    const messageId = String(b.messageId ?? "");
    const src = db.prepare("SELECT title FROM chats WHERE id=?").get(req.params.id) as { title: string } | undefined;
    if (!src) return res.status(404).json({ error: "not found" });
    try {
      const { newChatId } = forkChat(db, {
        chatId: req.params.id,
        uptoMessageId: messageId,
        title: String(b.title || `${src.title} (branch)`)
      });
      res.json({ id: newChatId });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  r.get("/messages/:id/siblings", (req, res) => {
    res.json(siblingsOf(db, req.params.id));
  });

  // her log — the only view the player gets of what she actually thinks
  r.get("/chats/:id/journal", (req, res) => {
    const rows = listJournal(db, req.params.id).map((j) => ({
      id: j.id,
      dayLabel: j.day_label,
      read: j.read_entry,
      world: j.world_entry,
      created_at: j.created_at
    }));
    res.json(rows);
  });

  // seal today by hand, for when you want to read it without waiting for the
  // day to roll over on its own
  r.post("/chats/:id/journal/seal", async (req, res) => {
    const chat = db.prepare("SELECT mode, world, opinion FROM chats WHERE id=?").get(req.params.id) as
      | { mode: string; world: string | null; opinion: string | null }
      | undefined;
    if (!chat) return res.status(404).json({ error: "not found" });
    const day = currentDay(chat);
    await sealDay(db, req.params.id, day.key, day.label, parseOpinion(chat.opinion).bond);
    const sealed = listJournal(db, req.params.id).some((j) => j.day_key === day.key);
    res.json({ sealed });
  });

  r.post("/chats/:id/checkpoints", (req, res) => {
    const chat = db.prepare("SELECT head_message_id h FROM chats WHERE id=?").get(req.params.id) as
      | { h: string | null }
      | undefined;
    if (!chat) return res.status(404).json({ error: "not found" });
    const messageId = String(req.body?.messageId || chat.h || "");
    if (!messageId) return res.status(400).json({ error: "empty chat" });
    const id = newId();
    db.prepare("INSERT INTO checkpoints(id,chat_id,message_id,name,created_at) VALUES(?,?,?,?,?)").run(
      id,
      req.params.id,
      messageId,
      String(req.body?.name || "Checkpoint"),
      Date.now()
    );
    res.json({ id });
  });

  r.post("/checkpoints/:id/restore", (req, res) => {
    const cp = db.prepare("SELECT * FROM checkpoints WHERE id=?").get(req.params.id) as
      | { chat_id: string; message_id: string }
      | undefined;
    if (!cp) return res.status(404).json({ error: "not found" });
    setHead(db, cp.chat_id, cp.message_id);
    res.json({ ok: true });
  });

  r.delete("/checkpoints/:id", (req, res) => {
    db.prepare("DELETE FROM checkpoints WHERE id=?").run(req.params.id);
    res.json({ ok: true });
  });

  // ---- per-chat out-of-character channel with the "director" ----

  r.get("/chats/:id/ooc", (req, res) => {
    const rows = db
      .prepare("SELECT id,role,content,created_at FROM ooc_messages WHERE chat_id=? ORDER BY created_at ASC")
      .all(req.params.id);
    const chat = db.prepare("SELECT directives FROM chats WHERE id=?").get(req.params.id) as
      | { directives: string | null }
      | undefined;
    let directives: string[] = [];
    try {
      directives = JSON.parse(chat?.directives || "[]");
    } catch { /* fresh chat */ }
    res.json({ messages: rows, directives });
  });

  r.post("/chats/:id/ooc", async (req, res) => {
    const chat = db.prepare("SELECT * FROM chats WHERE id=?").get(req.params.id) as
      | { id: string; stage_id: string; episode_cap: number; directives: string | null }
      | undefined;
    if (!chat) return res.status(404).json({ error: "not found" });
    const content = String(req.body?.content ?? "").trim();
    if (!content) return res.status(400).json({ error: "empty message" });

    const now = Date.now();
    db.prepare("INSERT INTO ooc_messages(id,chat_id,role,content,created_at) VALUES(?,?,?,?,?)").run(
      newId(), chat.id, "user", content, now
    );

    try {
      const settings = getSettings(db);
      // full-canon retrieval (cap 51): the PLAYER is asking, not Beni — may spoil
      const canon = await retrieveCanon(db, content, { cap: 51, k: 6 });
      const history = db
        .prepare("SELECT role,content FROM ooc_messages WHERE chat_id=? ORDER BY created_at DESC LIMIT 8")
        .all(chat.id) as { role: string; content: string }[];
      let directives: string[] = [];
      try {
        directives = JSON.parse(chat.directives || "[]");
      } catch { /* none */ }

      const raw = await completeChat(
        [
          {
            role: "system",
            content:
              "You are the DIRECTOR of a Tenkai Knights roleplay app (the character is Beni). This is the out-of-character channel: the player talks to the system here, not to Beni. " +
              "Answer canon questions honestly and concisely using the reference notes (cite episode numbers plainly; full-series knowledge allowed — warn briefly before real spoilers). If the notes don't cover it, say you're not sure rather than guess. " +
              "When the player gives a correction or steering instruction about the roleplay ('Beni didn't do that', 'stop doing X', 'she should be colder'), acknowledge it and distill it into ONE short imperative directive for the character model. " +
              `Existing directives: ${JSON.stringify(directives)}. ` +
              "End your reply with exactly one line: 'DIRECTIVE: <short imperative>' if a new directive should be saved, or 'DIRECTIVE: none'.\n\nCanon reference notes:\n" +
              canon.map((c) => `- [${c.docTitle}${c.episode !== null ? ` · ep ${c.episode}` : ""}] ${c.text.replace(/\n+/g, " ").slice(0, 300)}`).join("\n")
          },
          ...history.reverse().map((m) => ({ role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant", content: m.content }))
        ],
        {
          baseUrl: settings.llm.baseUrl,
          apiKey: settings.llm.apiKey,
          model: settings.llm.model,
          temperature: 0.4,
          maxTokens: 450,
          topP: 0.9
        }
      );

      let reply = raw.trim();
      const dm = reply.match(/DIRECTIVE:\s*(.+)\s*$/i);
      if (dm) {
        reply = reply.slice(0, dm.index).trim();
        const d = dm[1].trim();
        if (d && d.toLowerCase() !== "none") {
          directives = [...directives, d].slice(-12);
          db.prepare("UPDATE chats SET directives=? WHERE id=?").run(JSON.stringify(directives), chat.id);
        }
      }
      db.prepare("INSERT INTO ooc_messages(id,chat_id,role,content,created_at) VALUES(?,?,?,?,?)").run(
        newId(), chat.id, "assistant", reply || "(no reply)", Date.now()
      );
      res.json({ reply, directives });
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  r.delete("/chats/:id/directives/:index", (req, res) => {
    const chat = db.prepare("SELECT directives FROM chats WHERE id=?").get(req.params.id) as
      | { directives: string | null }
      | undefined;
    if (!chat) return res.status(404).json({ error: "not found" });
    let directives: string[] = [];
    try {
      directives = JSON.parse(chat.directives || "[]");
    } catch { /* none */ }
    directives.splice(Number(req.params.index), 1);
    db.prepare("UPDATE chats SET directives=? WHERE id=?").run(JSON.stringify(directives), req.params.id);
    res.json({ directives });
  });

  r.get("/chats/:id/memories", (req, res) => {
    const rows = db
      .prepare("SELECT id,text,importance,created_at FROM memories WHERE chat_id=? ORDER BY created_at DESC")
      .all(req.params.id);
    res.json(rows);
  });

  r.delete("/memories/:id", (req, res) => {
    db.prepare("DELETE FROM memories WHERE id=?").run(req.params.id);
    res.json({ ok: true });
  });

  return r;
}

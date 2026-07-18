import { Router } from "express";
import type { Db } from "../db.js";
import { newId } from "../db.js";
import { pathToRoot, siblingsOf, forkChat, setHead, getMessage, latestLeafFrom } from "../core/tree.js";
import { loadStages, getStage, loadScenarios } from "../prompt/builder.js";

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
    db.prepare(
      "INSERT INTO chats(id,title,mode,stage_id,episode_cap,story_episode,user_looks,opinion,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)"
    ).run(id, String(b.title || "New chat"), mode, stage.id, cap, storyEpisode, userLooks, opinion, now, now);

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

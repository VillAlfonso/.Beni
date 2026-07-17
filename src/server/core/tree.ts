import type { Db } from "../db.js";
import { newId } from "../db.js";

export interface Msg {
  id: string;
  chat_id: string;
  parent_id: string | null;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: number;
  meta: string | null;
}

export function getMessage(db: Db, id: string): Msg | undefined {
  return db.prepare("SELECT * FROM messages WHERE id=?").get(id) as Msg | undefined;
}

/** Messages from root to the given message (inclusive), following parent links. */
export function pathToRoot(db: Db, messageId: string): Msg[] {
  const out: Msg[] = [];
  let cur = getMessage(db, messageId);
  const seen = new Set<string>();
  while (cur) {
    if (seen.has(cur.id)) break; // corrupt tree guard
    seen.add(cur.id);
    out.push(cur);
    cur = cur.parent_id ? getMessage(db, cur.parent_id) : undefined;
  }
  return out.reverse();
}

/** All children of the same parent within the same chat, ordered by creation. */
export function siblingsOf(db: Db, messageId: string): { ids: string[]; index: number } {
  const msg = getMessage(db, messageId);
  if (!msg) return { ids: [], index: -1 };
  const rows = (msg.parent_id
    ? db
        .prepare("SELECT id FROM messages WHERE chat_id=? AND parent_id=? ORDER BY created_at, rowid")
        .all(msg.chat_id, msg.parent_id)
    : db
        .prepare("SELECT id FROM messages WHERE chat_id=? AND parent_id IS NULL ORDER BY created_at, rowid")
        .all(msg.chat_id)) as { id: string }[];
  const ids = rows.map((r) => r.id);
  return { ids, index: ids.indexOf(messageId) };
}

/** Latest leaf below (or at) a message — used when switching branches. */
export function latestLeafFrom(db: Db, messageId: string): string {
  let curId = messageId;
  for (;;) {
    const child = db
      .prepare("SELECT id FROM messages WHERE parent_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1")
      .get(curId) as { id: string } | undefined;
    if (!child) return curId;
    curId = child.id;
  }
}

export function createMessage(
  db: Db,
  opts: {
    chatId: string;
    parentId: string | null;
    role: Msg["role"];
    content: string;
    meta?: unknown;
  }
): Msg {
  const id = newId();
  const created_at = Date.now();
  db.prepare(
    "INSERT INTO messages(id,chat_id,parent_id,role,content,created_at,meta) VALUES(?,?,?,?,?,?,?)"
  ).run(id, opts.chatId, opts.parentId, opts.role, opts.content, created_at, opts.meta ? JSON.stringify(opts.meta) : null);
  return getMessage(db, id)!;
}

export function setHead(db: Db, chatId: string, messageId: string | null): void {
  db.prepare("UPDATE chats SET head_message_id=?, updated_at=? WHERE id=?").run(messageId, Date.now(), chatId);
}

/**
 * Duplicate a chat up to (and including) a message: copies the path with fresh
 * ids and all memories created up to that message's time. Returns new chat id.
 */
export function forkChat(
  db: Db,
  opts: { chatId: string; uptoMessageId: string; title: string }
): { newChatId: string } {
  const src = db.prepare("SELECT * FROM chats WHERE id=?").get(opts.chatId) as Record<string, unknown> | undefined;
  if (!src) throw new Error("chat not found");
  const upto = getMessage(db, opts.uptoMessageId);
  if (!upto || upto.chat_id !== opts.chatId) throw new Error("message not in chat");

  const path = pathToRoot(db, opts.uptoMessageId);
  const newChatId = newId();
  const now = Date.now();

  const run = db.transaction(() => {
    db.prepare(
      `INSERT INTO chats(id,title,mode,stage_id,episode_cap,story_episode,head_message_id,forked_from,created_at,updated_at)
       VALUES(?,?,?,?,?,?,NULL,?,?,?)`
    ).run(
      newChatId,
      opts.title,
      src.mode,
      src.stage_id,
      src.episode_cap,
      src.story_episode,
      opts.chatId,
      now,
      now
    );

    let parent: string | null = null;
    let lastNew: string | null = null;
    const insert = db.prepare(
      "INSERT INTO messages(id,chat_id,parent_id,role,content,created_at,meta) VALUES(?,?,?,?,?,?,?)"
    );
    for (const m of path) {
      const nid = newId();
      insert.run(nid, newChatId, parent, m.role, m.content, m.created_at, m.meta);
      parent = nid;
      lastNew = nid;
    }
    db.prepare("UPDATE chats SET head_message_id=? WHERE id=?").run(lastNew, newChatId);

    // copy memories that existed by the fork point OR were distilled from
    // messages inside the copied path (extraction can lag a few ms behind)
    const pathIds = new Set(path.map((m) => m.id));
    const mems = (db
      .prepare("SELECT * FROM memories WHERE chat_id=? ORDER BY created_at")
      .all(opts.chatId) as {
      text: string;
      importance: number;
      src_message_id: string | null;
      embedding: Buffer | null;
      created_at: number;
    }[]).filter((m) => m.created_at <= upto.created_at || (m.src_message_id !== null && pathIds.has(m.src_message_id)));
    const insMem = db.prepare(
      "INSERT INTO memories(id,chat_id,text,importance,src_message_id,embedding,created_at) VALUES(?,?,?,?,?,?,?)"
    );
    for (const mm of mems) insMem.run(newId(), newChatId, mm.text, mm.importance, null, mm.embedding, mm.created_at);
  });
  run();

  return { newChatId };
}

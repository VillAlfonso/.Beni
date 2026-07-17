import test from "node:test";
import assert from "node:assert/strict";
import { openDb, newId } from "../db.js";
import { createMessage, pathToRoot, siblingsOf, forkChat, setHead, latestLeafFrom } from "./tree.js";

function makeChat(db: ReturnType<typeof openDb>) {
  const id = newId();
  db.prepare(
    "INSERT INTO chats(id,title,mode,stage_id,episode_cap,created_at,updated_at) VALUES(?,?,?,?,?,?,?)"
  ).run(id, "t", "isolated", "s1-infiltrator", 25, Date.now(), Date.now());
  return id;
}

test("path, siblings and branch switching", () => {
  const db = openDb(":memory:");
  const chat = makeChat(db);
  const u1 = createMessage(db, { chatId: chat, parentId: null, role: "user", content: "hi" });
  const a1 = createMessage(db, { chatId: chat, parentId: u1.id, role: "assistant", content: "reply A" });
  const a2 = createMessage(db, { chatId: chat, parentId: u1.id, role: "assistant", content: "reply B" });

  const path = pathToRoot(db, a2.id);
  assert.deepEqual(path.map((m) => m.content), ["hi", "reply B"]);

  const sib = siblingsOf(db, a2.id);
  assert.equal(sib.ids.length, 2);
  assert.equal(sib.index, 1);
  assert.equal(sib.ids[0], a1.id);

  const u2 = createMessage(db, { chatId: chat, parentId: a2.id, role: "user", content: "more" });
  assert.equal(latestLeafFrom(db, a2.id), u2.id);
  assert.equal(latestLeafFrom(db, a1.id), a1.id);
  setHead(db, chat, u2.id);
  const head = db.prepare("SELECT head_message_id h FROM chats WHERE id=?").get(chat) as { h: string };
  assert.equal(head.h, u2.id);
});

test("forkChat copies path and past memories only", () => {
  const db = openDb(":memory:");
  const chat = makeChat(db);
  const u1 = createMessage(db, { chatId: chat, parentId: null, role: "user", content: "one" });
  const a1 = createMessage(db, { chatId: chat, parentId: u1.id, role: "assistant", content: "two" });

  db.prepare("INSERT INTO memories(id,chat_id,text,importance,created_at) VALUES(?,?,?,?,?)").run(
    newId(), chat, "early memory", 3, a1.created_at - 5
  );

  const u2 = createMessage(db, { chatId: chat, parentId: a1.id, role: "user", content: "three" });
  db.prepare("INSERT INTO memories(id,chat_id,text,importance,created_at) VALUES(?,?,?,?,?)").run(
    newId(), chat, "future memory", 3, u2.created_at + 60_000
  );
  // extracted later but anchored to a message inside the fork path → copied
  db.prepare("INSERT INTO memories(id,chat_id,text,importance,src_message_id,created_at) VALUES(?,?,?,?,?,?)").run(
    newId(), chat, "late-extracted memory", 3, a1.id, u2.created_at + 120_000
  );

  const { newChatId } = forkChat(db, { chatId: chat, uptoMessageId: a1.id, title: "fork" });

  const msgs = db.prepare("SELECT content FROM messages WHERE chat_id=? ORDER BY created_at").all(newChatId) as {
    content: string;
  }[];
  assert.deepEqual(msgs.map((m) => m.content), ["one", "two"]);

  const mems = db.prepare("SELECT text FROM memories WHERE chat_id=?").all(newChatId) as { text: string }[];
  assert.deepEqual(mems.map((m) => m.text).sort(), ["early memory", "late-extracted memory"]);

  const nc = db.prepare("SELECT head_message_id h, forked_from f FROM chats WHERE id=?").get(newChatId) as {
    h: string; f: string;
  };
  assert.equal(nc.f, chat);
  const headMsg = db.prepare("SELECT content FROM messages WHERE id=?").get(nc.h) as { content: string };
  assert.equal(headMsg.content, "two");
});

import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type Db = Database.Database;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const DATA_DIR = path.join(ROOT, "data");
export const PROJECT_ROOT = ROOT;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings(
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS docs(
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  episode REAL,
  url TEXT,
  content TEXT NOT NULL,
  hash TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS docs_src_title ON docs(source, title);
CREATE TABLE IF NOT EXISTS chunks(
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  text TEXT NOT NULL,
  episode REAL,
  kind TEXT NOT NULL,
  embedding BLOB
);
CREATE INDEX IF NOT EXISTS chunks_doc ON chunks(doc_id);
CREATE TABLE IF NOT EXISTS chats(
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'isolated',
  stage_id TEXT NOT NULL DEFAULT 's4-change-of-heart',
  episode_cap REAL NOT NULL DEFAULT 51,
  story_episode REAL,
  head_message_id TEXT,
  forked_from TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages(
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  parent_id TEXT,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  meta TEXT
);
CREATE INDEX IF NOT EXISTS messages_chat ON messages(chat_id);
CREATE INDEX IF NOT EXISTS messages_parent ON messages(parent_id);
CREATE TABLE IF NOT EXISTS checkpoints(
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS memories(
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  importance REAL NOT NULL DEFAULT 3,
  src_message_id TEXT,
  embedding BLOB,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS memories_chat ON memories(chat_id);
`;

export function openDb(file: string): Db {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  // migrations: columns added after first release
  const chatCols = db.prepare("PRAGMA table_info(chats)").all() as { name: string }[];
  if (!chatCols.some((c) => c.name === "user_looks")) {
    db.exec("ALTER TABLE chats ADD COLUMN user_looks TEXT");
  }
  if (!chatCols.some((c) => c.name === "opinion")) {
    db.exec("ALTER TABLE chats ADD COLUMN opinion TEXT");
  }
  if (!chatCols.some((c) => c.name === "world")) {
    db.exec("ALTER TABLE chats ADD COLUMN world TEXT");
  }
  if (!chatCols.some((c) => c.name === "directives")) {
    db.exec("ALTER TABLE chats ADD COLUMN directives TEXT");
  }
  db.exec(`CREATE TABLE IF NOT EXISTS ooc_messages(
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS ooc_chat ON ooc_messages(chat_id);`);
  return db;
}

let singleton: Db | null = null;
export function getDb(): Db {
  if (!singleton) singleton = openDb(path.join(DATA_DIR, "beni.db"));
  return singleton;
}

export function newId(): string {
  return randomUUID();
}

export function getSetting(db: Db, key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key=?").get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

export function setSetting(db: Db, key: string, value: string): void {
  db.prepare(
    "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
  ).run(key, value);
}

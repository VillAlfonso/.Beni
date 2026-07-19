/**
 * Her log, sealed at the end of each day.
 *
 * This is the ONLY window the player gets into what she actually thinks — the
 * numbers behind it stay hidden forever. Two entries per day, always:
 *   1. how she read the player that day (can sour as easily as it can warm)
 *   2. where her head is otherwise — the war, the mission, what she's become,
 *      and what the player is doing to the shape of it
 *
 * Days are in-world days in story mode, real days in isolated chats.
 */
import type { Db } from "../db.js";
import { newId } from "../db.js";
import { getSettings } from "../settings.js";
import { completeChat } from "../llm/provider.js";
import { pathToRoot } from "../core/tree.js";
import { parseWorld, loadStoryPressures, getStage } from "../prompt/builder.js";
import { eligibilityFrom, tierOf, type Bond } from "../prompt/bond.js";

export interface JournalRow {
  id: string;
  chat_id: string;
  day_key: string;
  day_label: string;
  read_entry: string;
  world_entry: string;
  until_at: number;
  created_at: number;
}

/** Which day a chat is currently living in. */
export function currentDay(chat: { mode: string; world: string | null }): { key: string; label: string } {
  if (chat.mode === "story") {
    const w = parseWorld(chat.world);
    if (w) return { key: `d${w.clock.day}`, label: `Day ${w.clock.day}` };
  }
  const d = new Date();
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { key, label: d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) };
}

export function recentJournal(db: Db, chatId: string, n = 2): { dayLabel: string; read: string; world: string }[] {
  const rows = db
    .prepare("SELECT day_label, read_entry, world_entry FROM journal WHERE chat_id=? ORDER BY created_at DESC LIMIT ?")
    .all(chatId, n) as { day_label: string; read_entry: string; world_entry: string }[];
  return rows
    .reverse()
    .map((r) => ({ dayLabel: r.day_label, read: r.read_entry, world: r.world_entry }));
}

export function listJournal(db: Db, chatId: string): JournalRow[] {
  return db
    .prepare("SELECT * FROM journal WHERE chat_id=? ORDER BY created_at DESC")
    .all(chatId) as JournalRow[];
}

/**
 * Seal one day into the log. Idempotent per (chat, day). Fire-and-forget:
 * a failure here must never disturb the roleplay.
 */
export async function sealDay(
  db: Db,
  chatId: string,
  dayKey: string,
  dayLabel: string,
  bond: Bond
): Promise<void> {
  try {
    const already = db.prepare("SELECT id FROM journal WHERE chat_id=? AND day_key=?").get(chatId, dayKey);
    if (already) return;

    const chat = db
      .prepare("SELECT head_message_id h, mode, stage_id, story_episode, user_looks, world, opinion FROM chats WHERE id=?")
      .get(chatId) as
      | {
          h: string | null;
          mode: string;
          stage_id: string;
          story_episode: number | null;
          user_looks: string | null;
          world: string | null;
          opinion: string | null;
        }
      | undefined;
    if (!chat?.h) return;

    const lastSeal = db
      .prepare("SELECT MAX(until_at) t FROM journal WHERE chat_id=?")
      .get(chatId) as { t: number | null };
    const since = lastSeal.t ?? 0;

    const path = pathToRoot(db, chat.h);
    const fresh = path.filter((m) => m.created_at > since);
    if (fresh.filter((m) => m.role === "user").length < 2) return; // too thin to be a day

    const settings = getSettings(db);
    const user = settings.userName || "them";
    const tier = tierOf(bond);
    const stage = getStage(chat.stage_id);
    const world = parseWorld(chat.world);
    const pressures = loadStoryPressures()[chat.stage_id];

    const excerpt = fresh
      .slice(-30)
      .map((m) => `${m.role === "assistant" ? "Beni" : user}: ${m.content}`)
      .join("\n")
      .slice(-9000);

    const priorRows = db
      .prepare("SELECT read_entry FROM journal WHERE chat_id=? ORDER BY created_at DESC LIMIT 1")
      .all(chatId) as { read_entry: string }[];
    const prior = priorRows[0]?.read_entry;

    const raw = await completeChat(
      [
        {
          role: "system",
          content:
            "You are writing Beni's private log for the night, in her own first-person voice — sharp, sarcastic, guarded, thirteen, allergic to sincerity but occasionally ambushed by it. " +
            `Where she is in her story: ${stage.label} — ${stage.short}. ` +
            (world ? `This timeline: day ${world.clock.day}, divergence ${world.divergence}. ${world.beni ? `Her condition: ${world.beni}. ` : ""}` : "") +
            (pressures ? `What's on her plate: ${pressures.busy} Stakes: ${pressures.stakes} ` : "") +
            `How close she privately is to ${user} right now: "${tier}". ` +
            (prior ? `What she wrote about them last time: "${prior}" ` : "") +
            "Write TWO entries.\n" +
            `"read" — what she makes of ${user} after today. Her honest private assessment, 2-4 sentences, in her voice. It must MATCH the closeness above without ever naming it, quoting a score, or explaining a system. If today went badly, it gets colder or sharper; warmth she hasn't earned must not appear. She never writes the words "guard", "bond", "level" or "tier".\n` +
            `"world" — 2-4 sentences on everything else: how the fight and her place in it look to her tonight, how she's going about what she has to do next, and what ${user} is actually doing to her and to where this is all heading. Concrete, not abstract.\n` +
            'Respond ONLY with JSON: {"read":"...","world":"..."}'
        },
        { role: "user", content: excerpt }
      ],
      {
        baseUrl: settings.utility.baseUrl,
        apiKey: settings.utility.apiKey,
        model: settings.utility.model,
        temperature: 0.6,
        maxTokens: 420,
        topP: 0.9
      }
    );

    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return;
    let parsed: { read?: unknown; world?: unknown };
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return;
    }
    const read = String(parsed.read ?? "").trim();
    const worldEntry = String(parsed.world ?? "").trim();
    if (read.length < 10 || worldEntry.length < 10) return;

    const until = fresh.length ? Math.max(...fresh.map((m) => m.created_at)) : Date.now();
    db.prepare(
      "INSERT OR IGNORE INTO journal(id,chat_id,day_key,day_label,read_entry,world_entry,until_at,created_at) VALUES(?,?,?,?,?,?,?,?)"
    ).run(newId(), chatId, dayKey, dayLabel, read.slice(0, 1200), worldEntry.slice(0, 1200), until, Date.now());
  } catch (err) {
    console.warn("journal seal skipped:", (err as Error).message);
  }
}

import { Router } from "express";
import type { Db } from "../db.js";
import { newId } from "../db.js";
import { pathToRoot, siblingsOf, forkChat, setHead, getMessage, latestLeafFrom } from "../core/tree.js";
import { loadStages, getStage, loadScenarios, loadStoryPressures, parseOpinion } from "../prompt/builder.js";
import { listJournal, sealDay, currentDay } from "../memory/journal.js";
import { retrieveCanon } from "../rag/retrieve.js";
import { getSettings } from "../settings.js";
import { completeChat } from "../llm/provider.js";
import { episodeEntry, allEpisodes, allArcs, allArtifacts, loadTimeline } from "../timeline/load.js";
import { seedWorld, arcForEpisode, custodyAsOf, capabilitiesAsOf } from "../timeline/state.js";
import { parseWorldV2 } from "../timeline/world.js";
import type { Stage } from "../prompt/builder.js";

type PostId = "s5-aftermath" | "s5-knight";

/** Everything a new/reseeded story chat needs, derived from the chosen start. */
function storySetup(storyEpisode: number, post: PostId | null, stages: Stage[]): {
  stageId: string;
  cap: number;
  world: string;
  opening: string | null;
} {
  const arcs = allArcs();
  if (post) {
    const stage = stages.find((s) => s.id === post) ?? stages[stages.length - 1];
    const entry = loadTimeline().post.find((p) => p.id === post);
    const finale = episodeEntry(51);
    const day = Math.max(1, (finale ? finale.days.end : 0) + (entry?.daysAfterFinale ?? 3));
    const arc = arcs.find((a) => a.id === post) ?? null;
    const world = {
      // pseudo-episode numbers past the 51-episode series select the post arcs
      cursor: { day, timeOfDay: "morning", episode: post === "s5-aftermath" ? 52 : 53 },
      goals: [],
      divergence: [],
      artifactOverrides: [],
      pressures: (arc?.watchers ?? []).map((w) => ({ who: w.who, level: w.start, note: "" })),
      events: [],
      beni: ""
    };
    const opening = entry ? `*${entry.situation}*\n\n${stage.greeting}` : stage.greeting;
    return { stageId: stage.id, cap: stage.cap, world: JSON.stringify(world), opening };
  }

  const tl = episodeEntry(storyEpisode);
  if (tl) {
    // era at the episode's FIRST frame; s0-discovery has no stage file — the
    // pre-arrival prompt note carries that era, persona defaults to s1
    const stageId = stages.some((s) => s.id === tl.arcAtStart) ? tl.arcAtStart : "s1-infiltrator";
    const world = seedWorld(tl, arcForEpisode(tl.no, arcs));
    const opening = `*${tl.start.situation}*\n\n${tl.start.firstContact}`;
    return { stageId, cap: storyEpisode, world: JSON.stringify(world), opening };
  }

  // uncovered episode: legacy v1 world + stage from the old range derivation
  const ranged = stages.find((s) => storyEpisode >= s.episodeRange[0] && storyEpisode <= s.episodeRange[1]);
  const stageId = ranged?.id ?? stages[stages.length - 1].id;
  const info = loadStoryPressures()[stageId];
  const world = {
    divergence: "none",
    clock: { day: 1, timeOfDay: "afternoon" },
    pressures: (info?.watchers ?? []).map((w) => ({ who: w.who, level: w.start, note: "" })),
    events: [],
    beni: ""
  };
  return { stageId, cap: storyEpisode, world: JSON.stringify(world), opening: null };
}

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
    // Story-only creation: isolated mode is retired (legacy isolated chats stay readable).
    const post: PostId | null = b.post === "s5-aftermath" || b.post === "s5-knight" ? b.post : null;
    const storyEpisode = post ? 51 : Math.min(51, Math.max(1, Number(b.storyEpisode) || 14));
    const setup = storySetup(storyEpisode, post, stages);
    const stage = getStage(setup.stageId);
    const id = newId();
    const now = Date.now();
    const userLooks = String(b.userLooks ?? "").trim() || null;
    const opinion = JSON.stringify({ label: "a stranger", note: "", guard: 1 });
    db.prepare(
      "INSERT INTO chats(id,title,mode,stage_id,episode_cap,story_episode,user_looks,opinion,world,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)"
    ).run(id, String(b.title || "New chat"), "story", stage.id, setup.cap, storyEpisode, userLooks, opinion, setup.world, now, now);

    // Opening scene: the episode's authored situation + first contact when the
    // timeline covers it; otherwise the old per-stage scenario pool.
    let opening = setup.opening;
    if (!opening) {
      const pool = loadScenarios()[stage.id] ?? [];
      opening = pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : stage.greeting;
    }
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
      // Hard timeline jump: messages are kept, but the world reseeds at the
      // new episode's start — cursor, goals, pressures, divergence all fresh.
      const ep = Math.min(51, Math.max(1, Number(b.storyEpisode) || 1));
      const setup = storySetup(ep, null, loadStages());
      db.prepare("UPDATE chats SET story_episode=?, episode_cap=?, stage_id=?, world=?, updated_at=? WHERE id=?").run(
        ep,
        setup.cap,
        setup.stageId,
        setup.world,
        Date.now(),
        req.params.id
      );
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

  // the Timeline panel: cursor, ledgers, custody, capabilities — spoilers visible
  r.get("/chats/:id/timeline", (req, res) => {
    const chat = db.prepare("SELECT mode, stage_id, story_episode, world FROM chats WHERE id=?").get(req.params.id) as
      | { mode: string; stage_id: string; story_episode: number | null; world: string | null }
      | undefined;
    if (!chat) return res.status(404).json({ error: "not found" });
    if (chat.mode !== "story") return res.json({ covered: false });

    const eps = allEpisodes();
    const world = parseWorldV2(chat.world, chat.story_episode, eps);
    if (!world) return res.json({ covered: false });

    const entry = eps.find((e) => e.no === world.cursor.episode) ?? null;
    const arc = arcForEpisode(world.cursor.episode, allArcs());
    const artifacts = allArtifacts();
    const custody = custodyAsOf(world.cursor.day, artifacts, world.artifactOverrides);
    const overridden = new Set(
      world.artifactOverrides.filter((o) => world.cursor.day >= o.sinceDay).map((o) => o.item)
    );
    res.json({
      covered: entry !== null,
      cursor: world.cursor,
      arc: arc ? { id: arc.id, label: arc.label } : null,
      episode: entry ? { no: entry.no, title: entry.title, days: [entry.days.start, entry.days.end] } : null,
      goals: world.goals,
      divergence: world.divergence,
      artifactCustody: artifacts
        .filter((a) => custody.has(a.id))
        .map((a) => ({ item: a.id, name: a.name, holder: custody.get(a.id), overridden: overridden.has(a.id) })),
      capabilities: capabilitiesAsOf(world.cursor.day, artifacts, world.artifactOverrides),
      pressures: world.pressures,
      events: world.events,
      beni: world.beni
    });
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

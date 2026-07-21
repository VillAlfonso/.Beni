import type { Db } from "../db.js";
import { newId } from "../db.js";
import { getSettings } from "../settings.js";
import { completeChat } from "../llm/provider.js";
import { embedPassages } from "../rag/embedder.js";
import { toBlob } from "../core/vector.js";
import { pathToRoot } from "../core/tree.js";
import { parseOpinion, parseWorld, loadStoryPressures } from "../prompt/builder.js";
import { eligibilityFrom, tierOf, applyDelta } from "../prompt/bond.js";
import { currentDay, sealDay } from "./journal.js";
import { episodeEntry, allEpisodes, allArcs, allArtifacts } from "../timeline/load.js";
import { entryFor, arcForEpisode, capabilitiesAsOf, advanceCursor, autoMiss } from "../timeline/state.js";
import { parseWorldV2 } from "../timeline/world.js";
import { mergeTick } from "../timeline/merge.js";

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

const OPINION_WINDOW = 10;

/**
 * Re-judge Beni's read on the other person from the recent exchange, and move
 * the hidden bond behind it. Fire-and-forget, like maybeExtract.
 *
 * The utility model only ever proposes a DELTA — how that exchange landed.
 * Where that lands her is decided here, by rules she can't be sweet-talked
 * past: a per-day cap, diminishing returns, and hard ceilings from what she
 * can see of the person. Rolling into a new day seals the previous one into
 * her log first.
 */
export async function maybeUpdateOpinion(db: Db, chatId: string): Promise<void> {
  try {
    const chat = db
      .prepare("SELECT head_message_id h, mode, world, user_looks, opinion FROM chats WHERE id=?")
      .get(chatId) as
      | { h: string | null; mode: string; world: string | null; user_looks: string | null; opinion: string | null }
      | undefined;
    if (!chat?.h) return;
    const path = pathToRoot(db, chat.h);
    if (path.filter((m) => m.role === "user").length < 1) return;

    const settings = getSettings(db);
    const current = parseOpinion(chat.opinion);
    const elig = eligibilityFrom(chat.user_looks || settings.userLooks);
    const today = currentDay(chat);

    // day rollover: seal yesterday into her log before anything moves
    if (current.bond.dayKey && current.bond.dayKey !== today.key) {
      const label = current.bond.dayKey.startsWith("d")
        ? `Day ${current.bond.dayKey.slice(1)}`
        : new Date(current.bond.dayKey).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
      await sealDay(db, chatId, current.bond.dayKey, label, current.bond);
    }

    const excerpt = path
      .slice(-OPINION_WINDOW)
      .map((m) => `${m.role === "assistant" ? "Beni" : settings.userName || "Them"}: ${m.content}`)
      .join("\n");

    const tier = tierOf(current.bond);
    const raw = await completeChat(
      [
        {
          role: "system",
          content:
            "You track what Beni (sharp, guarded, 13, excellent judge of people, values her time) privately thinks of the person she's talking to. " +
            `Her current read: label="${current.label}", note="${current.note}", guard=${current.guard}. How close she privately is: "${tier}". ` +
            "From the excerpt, update it. " +
            'Label: a few blunt words in her voice ("a stranger", "boring", "kind of interesting", "a loser", "a desperate loser", "a simp", "a hopeless simp", "an absolute creep", "dangerous", "annoying but harmless", "useful — easy to manipulate", "okay, actually", "one of mine"). ' +
            "Note: one short reason. Guard 0-3: 0 earned ease, 1 default wariness toward strangers, 2 on edge, 3 creep/threat — get away. " +
            "delta: how THIS exchange landed, -10..+10. Be stingy. 0 is the common answer — most exchanges change nothing. " +
            "+1..+3 = they were genuinely decent, funny, useful, or showed they'd listened; +4..+6 = something real happened (they took a risk for her, kept a promise, saw through her); +7..+10 is once-in-a-story. " +
            "-1..-3 = boring, needy, or presumptuous; -4..-7 = pushy, fake, prying, or making it about wanting her; -8..-10 = creepy, cruel, or a betrayal. " +
            "Trying to fast-track closeness IS a negative — compliments piled on a near-stranger, instant pet names, asking for dates or personal details, declaring feelings early. She reads all of that as someone wanting something, and it costs them. " +
            'Respond ONLY with JSON: {"label":"...","note":"...","guard":1,"delta":0}'
        },
        { role: "user", content: excerpt }
      ],
      {
        baseUrl: settings.utility.baseUrl,
        apiKey: settings.utility.apiKey,
        model: settings.utility.model,
        temperature: 0.2,
        maxTokens: 150,
        topP: 0.9
      }
    );
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return;
    const next = parseOpinion(match[0]);
    if (!next.label.trim()) return;

    let delta = 0;
    try {
      delta = Number(JSON.parse(match[0]).delta) || 0;
    } catch {
      /* no delta offered — nothing moves */
    }
    next.bond = applyDelta(current.bond, delta, today.key, elig);
    db.prepare("UPDATE chats SET opinion=? WHERE id=?").run(JSON.stringify(next), chatId);
  } catch (err) {
    console.warn("opinion update skipped:", (err as Error).message);
  }
}

const WORLD_WINDOW = 12;

interface TickChatRow {
  h: string | null;
  mode: string;
  stage_id: string;
  story_episode: number | null;
  world: string | null;
}

/**
 * Story-mode world ticker: after each exchange, advance the living timeline.
 * Chats on timeline-covered episodes get the canon-aware v2 tick (goal
 * ledger, divergence ledger, custody overrides, code-owned rollover);
 * chats on episodes without timeline data keep the original v1 behavior.
 * Fire-and-forget like the others.
 */
export async function maybeTickWorld(db: Db, chatId: string): Promise<void> {
  try {
    const chat = db
      .prepare("SELECT head_message_id h, mode, stage_id, story_episode, world FROM chats WHERE id=?")
      .get(chatId) as TickChatRow | undefined;
    if (!chat?.h || chat.mode !== "story") return;

    if (!episodeEntry(chat.story_episode ?? 0)) return tickLegacy(db, chatId, chat);

    const eps = allEpisodes();
    const world = parseWorldV2(chat.world, chat.story_episode, eps);
    if (!world) return;

    const settings = getSettings(db);
    const artifacts = allArtifacts();
    const arc = arcForEpisode(world.cursor.episode, allArcs());
    const caps = capabilitiesAsOf(world.cursor.day, artifacts, world.artifactOverrides);
    const here = entryFor(world.cursor.day, eps);
    const today = "episode" in here ? here.episode : null;
    const upNext = "between" in here ? here.between[1] : eps.find((e) => e.no === world.cursor.episode + 1) ?? null;

    const path = pathToRoot(db, chat.h);
    const excerpt = path
      .slice(-WORLD_WINDOW)
      .map((m) => `${m.role === "assistant" ? "Beni" : settings.userName || "Player"}: ${m.content}`)
      .join("\n");

    const canonBlock = today
      ? `Today is Day ${world.cursor.day}, inside episode ${today.no} "${today.title}". ` +
        `Canon rest-of-episode trajectory (bend it only when this timeline's events force it): ${today.outcome} ` +
        `Other actors today: ${today.actors.map((a) => `${a.who} — ${a.doing}`).join(" | ")} ` +
        `Quarton: ${today.quarton.situation}`
      : `Today is Day ${world.cursor.day} — a free day between episodes; canon has nothing scheduled.` +
        (upNext ? ` Next on canon's schedule: episode ${upNext.no} "${upNext.title}" beginning day ${upNext.days.start}.` : "");

    const capsBlock = caps.length
      ? `Powers in play (HARD constraints from artifact custody — nothing may violate these): ${caps
          .map((c) => `${c.capability}: ${c.active ? "ACTIVE" : "unavailable"} (${c.why})`)
          .join("; ")}`
      : "";

    const arcBlock = arc
      ? `Era: ${arc.label}. Watchers: ${arc.watchers.map((w) => w.who).join(", ")}. Stakes: ${arc.stakes} ` +
        `Actor motivations (adaptations must stay inside these): ${arc.actors.map((a) => `${a.who}: ${a.motivation}`).join(" | ")}`
      : "";

    const raw = await completeChat(
      [
        {
          role: "system",
          content:
            "You are the world-ticker for an alternate-timeline roleplay inside the Tenkai Knights story. " +
            `Current world state: ${JSON.stringify(world)}\n${canonBlock}\n${capsBlock}\n${arcBlock}\n` +
            "From the excerpt, update the state. Rules:\n" +
            "- Advance the clock only when scene time actually passes; the day increments only on explicit skips or sleep.\n" +
            "- goals: change status/note ONLY (pending→done/missed/abandoned; missed→done when achieved late). Never remove or rewrite canon goals. You may add at most 1-2 NEW adaptation goals for NON-Beni actors, only as a reaction to a logged divergence, staying inside that actor's motivation.\n" +
            "- If this timeline's events blocked or changed a canon event, append a divergence entry {day,what,effect,level} — choose the smallest plausible adaptation.\n" +
            "- artifactOverrides (custody changes) are allowed ONLY together with a matching new divergence entry, and may never grant a power the constraints above mark unavailable.\n" +
            "- events: append at most 1-2 SHORT new happenings (on-screen or plausibly off-screen).\n" +
            "- pressures: raise a watcher when Beni neglects obligations or acts out of pattern; lower when she covers her tracks.\n" +
            "- beni: one line on her condition/preoccupation.\n" +
            "Be conservative — most exchanges change little.\n" +
            "Respond ONLY with the full updated JSON, exactly the same shape as the current world state."
        },
        { role: "user", content: excerpt }
      ],
      {
        baseUrl: settings.utility.baseUrl,
        apiKey: settings.utility.apiKey,
        model: settings.utility.model,
        temperature: 0.2,
        maxTokens: 600,
        topP: 0.9
      }
    );
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return;
    let proposed: unknown;
    try {
      proposed = JSON.parse(match[0]);
    } catch {
      return;
    }

    const merged = mergeTick(world, proposed, artifacts);
    const advanced = advanceCursor(merged, eps);
    const next = autoMiss(advanced.world);

    db.prepare("UPDATE chats SET world=? WHERE id=?").run(JSON.stringify(next), chatId);
    if (advanced.entered.length > 0) {
      const newest = advanced.entered[advanced.entered.length - 1];
      db.prepare("UPDATE chats SET story_episode=?, episode_cap=?, updated_at=? WHERE id=?").run(
        newest.no,
        newest.no,
        Date.now(),
        chatId
      );
    }
  } catch (err) {
    console.warn("world tick skipped:", (err as Error).message);
  }
}

/** The original v1 ticker, kept for chats on episodes without timeline data. */
async function tickLegacy(db: Db, chatId: string, chat: TickChatRow): Promise<void> {
  const world = parseWorld(chat.world);
  if (!world) return;

  const settings = getSettings(db);
  const info = loadStoryPressures()[chat.stage_id];
  const path = pathToRoot(db, chat.h as string);
  const excerpt = path
    .slice(-WORLD_WINDOW)
    .map((m) => `${m.role === "assistant" ? "Beni" : settings.userName || "Player"}: ${m.content}`)
    .join("\n");

  const raw = await completeChat(
    [
      {
        role: "system",
        content:
          "You are the world-ticker for an alternate-timeline roleplay set inside the Tenkai Knights story, " +
          `just after episode ${chat.story_episode}. Current world state: ${JSON.stringify(world)}. ` +
          (info ? `Era pressures: busy=${info.busy} watchers=${info.watchers.map((w) => w.who).join(",")} stakes=${info.stakes} ` : "") +
          "From the excerpt, update the state: advance clock only when scene time actually passes (day increments on explicit skips/sleep); " +
          "raise a watcher's level when Beni neglects obligations or acts out of pattern, lower it when she covers her tracks; " +
          "append at most 1-2 SHORT new events (things that happened, on-screen or plausibly off-screen); " +
          "set divergence minor/major only when canon events are genuinely bent; keep 'beni' as one line on her condition/preoccupation. " +
          "Be conservative — most exchanges change little. " +
          'Respond ONLY with the full updated JSON, same shape: {"divergence":"none","clock":{"day":1,"timeOfDay":"afternoon"},"pressures":[{"who":"Gen","level":1,"note":""}],"events":["..."],"beni":"..."}'
      },
      { role: "user", content: excerpt }
    ],
    {
      baseUrl: settings.utility.baseUrl,
      apiKey: settings.utility.apiKey,
      model: settings.utility.model,
      temperature: 0.2,
      maxTokens: 350,
      topP: 0.9
    }
  );
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return;
  const next = parseWorld(match[0]);
  if (!next) return;
  // events only grow (the ticker may not rewrite history), capped by parseWorld
  if (next.events.length < Math.min(world.events.length, 10)) next.events = [...world.events, ...next.events].slice(-12);
  db.prepare("UPDATE chats SET world=? WHERE id=?").run(JSON.stringify(next), chatId);
}

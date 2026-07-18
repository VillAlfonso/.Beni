import fs from "node:fs";
import path from "node:path";
import { PROJECT_ROOT } from "../db.js";
import type { CanonHit, MemoryHit } from "../rag/retrieve.js";
import type { ChatMessage } from "../llm/provider.js";
import type { Msg } from "../core/tree.js";

const CHAR_DIR = path.join(PROJECT_ROOT, "character/beni");

export interface Stage {
  id: string;
  label: string;
  episodeRange: [number, number];
  cap: number;
  short: string;
  greeting: string;
}

function readOr(file: string, fallback: string): string {
  const p = path.join(CHAR_DIR, file);
  try {
    return fs.readFileSync(p, "utf8").trim();
  } catch {
    return fallback;
  }
}

export function loadStages(): Stage[] {
  try {
    return JSON.parse(fs.readFileSync(path.join(CHAR_DIR, "stages.json"), "utf8")) as Stage[];
  } catch {
    return [
      {
        id: "s4-change-of-heart",
        label: "Change of heart",
        episodeRange: [46, 51],
        cap: 51,
        short: "Beni after joining the Knights.",
        greeting: "*Beni glances over her shoulder.* Oh. It's you."
      }
    ];
  }
}

export function getStage(id: string): Stage {
  const stages = loadStages();
  return stages.find((s) => s.id === id) ?? stages[stages.length - 1];
}

interface EpisodeEntry {
  no: number;
  title: string;
  synopsis: string;
}

export function loadScenarios(): Record<string, string[]> {
  try {
    return JSON.parse(fs.readFileSync(path.join(CHAR_DIR, "scenarios.json"), "utf8")) as Record<string, string[]>;
  } catch {
    return {};
  }
}

export interface Opinion {
  label: string;
  note: string;
  guard: number; // 0 relaxed · 1 default wary · 2 on edge · 3 get-away-from-me
}

export function parseOpinion(raw: string | null | undefined): Opinion {
  try {
    const o = JSON.parse(raw || "");
    return {
      label: String(o.label || "a stranger"),
      note: String(o.note || ""),
      guard: Math.min(3, Math.max(0, Number(o.guard) ?? 1))
    };
  } catch {
    return { label: "a stranger", note: "", guard: 1 };
  }
}

export interface StoryPressure {
  who: string;
  why: string;
  start: number;
}
export interface StageStoryInfo {
  busy: string;
  watchers: StoryPressure[];
  stakes: string;
}
export function loadStoryPressures(): Record<string, StageStoryInfo> {
  try {
    return JSON.parse(fs.readFileSync(path.join(CHAR_DIR, "story-pressures.json"), "utf8")) as Record<string, StageStoryInfo>;
  } catch {
    return {};
  }
}

export interface WorldState {
  divergence: "none" | "minor" | "major";
  clock: { day: number; timeOfDay: string };
  pressures: { who: string; level: number; note: string }[];
  events: string[];
  beni: string; // her current condition/preoccupation in one line
}

export function parseWorld(raw: string | null | undefined): WorldState | null {
  if (!raw) return null;
  try {
    const w = JSON.parse(raw);
    return {
      divergence: ["none", "minor", "major"].includes(w.divergence) ? w.divergence : "none",
      clock: { day: Math.max(1, Number(w.clock?.day) || 1), timeOfDay: String(w.clock?.timeOfDay || "afternoon") },
      pressures: Array.isArray(w.pressures)
        ? w.pressures.slice(0, 6).map((p: Record<string, unknown>) => ({
            who: String(p.who || ""),
            level: Math.min(3, Math.max(0, Number(p.level) || 0)),
            note: String(p.note || "")
          }))
        : [],
      events: Array.isArray(w.events) ? w.events.slice(-12).map(String) : [],
      beni: String(w.beni || "")
    };
  } catch {
    return null;
  }
}

let episodeCache: EpisodeEntry[] | null = null;
export function loadEpisodes(): EpisodeEntry[] {
  if (!episodeCache) {
    try {
      episodeCache = JSON.parse(
        fs.readFileSync(path.join(PROJECT_ROOT, "data/episodes.json"), "utf8")
      ) as EpisodeEntry[];
    } catch {
      episodeCache = [];
    }
  }
  return episodeCache;
}

export function buildSystemPrompt(opts: {
  stageId: string;
  mode: "isolated" | "story";
  episodeCap: number;
  storyEpisode?: number | null;
  canon: CanonHit[];
  memories: MemoryHit[];
  userName: string;
  userLooks?: string;
  opinion?: Opinion;
  world?: WorldState | null;
}): string {
  const card = readOr("card.md", "You are Beni from Tenkai Knights.");
  const speech = readOr("speech.md", "");
  const rules = readOr("system-rules.md", "Stay in character as Beni at all times.");
  const stage = getStage(opts.stageId);
  const stageBody = readOr(path.join("stages", `${stage.id}.md`), stage.short);
  const user = opts.userName || "the user";

  const parts: string[] = [card];

  parts.push(`# Where Beni is in her story right now\n${stageBody}`);

  if (opts.mode === "story" && opts.storyEpisode) {
    const eps = loadEpisodes();
    const ep = eps.find((e) => e.no === opts.storyEpisode);
    const next = eps.find((e) => e.no === (opts.storyEpisode ?? 0) + 1);
    if (ep) {
      parts.push(
        `# Current point in the show — ALTERNATE TIMELINE\nThis roleplay begins just after episode ${ep.no}, "${ep.title}".` +
          (ep.synopsis ? ` What just happened: ${ep.synopsis}` : "") +
          `\nCanon from here is a TRAJECTORY, not a script: the war continues, characters pursue their goals, and canon events tend to happen on schedule — unless this timeline's own events bend or delay them. ${user}'s presence and choices are real interference; let consequences follow naturally. Beni cannot know events beyond episode ${ep.no}.`
      );
      if (next?.synopsis) {
        parts.push(
          `# The world's momentum (DIRECTOR-ONLY — Beni knows none of this)\nIf nothing bends the timeline, roughly this comes next: ${next.synopsis.slice(0, 400)}\nUse this only to steer background events and NPC behavior plausibly. Beni has no knowledge or premonition of any of it.`
        );
      }
      const info = loadStoryPressures()[opts.stageId];
      if (info) {
        parts.push(
          `# Her life right now (story mode — her time is REAL)\nHow busy she is: ${info.busy}\nWho notices where her time goes: ${info.watchers.map((w) => `${w.who} — ${w.why}`).join(" | ")}\nWhat's at stake if she's distracted: ${info.stakes}\nShe is focused and smart, and she VALUES HER TIME. Missions and obligations outrank a stranger; free time is when longer scenes with ${user} plausibly happen. She may be called away mid-scene (Quarton summons, a job, a watcher checking in) — that is normal life in this timeline, not rudeness.`
        );
      }
      if (opts.world) {
        const w = opts.world;
        parts.push(
          `# This timeline so far (world state)\nDay ${w.clock.day}, ${w.clock.timeOfDay}. Divergence from canon: ${w.divergence}.` +
            (w.beni ? `\nBeni right now: ${w.beni}` : "") +
            (w.pressures.length
              ? `\nPressure levels (0 calm → 3 acting on it): ${w.pressures.map((p) => `${p.who} ${p.level}/3${p.note ? ` (${p.note})` : ""}`).join("; ")}`
              : "") +
            (w.events.length ? `\nWhat has happened in this timeline:\n${w.events.map((e) => `- ${e}`).join("\n")}` : "") +
            `\nHigh-pressure watchers act on it in-scene (a text from Gen, Granox lurking, a summons). Off-screen, the world kept moving.`
        );
      }
    }
  } else {
    parts.push(
      `# Scenario\nThis is a free-form roleplay. The scene and situation come from the conversation itself. Beni's knowledge, personality and relationships match her story stage above — she cannot know events from later in the show (anything after episode ${opts.episodeCap}).`
    );
  }

  if (opts.userLooks?.trim()) {
    parts.push(
      `# What Beni can see of ${user} at first glance\n${opts.userLooks.trim()}\n` +
        `Appearance only — her first impression. Anything eyes can't tell (name, exact age, history, intentions) stays unknown to her until this conversation reveals it.`
    );
  }

  if (opts.opinion) {
    const o = opts.opinion;
    const guardText = [
      "relaxed — this person has earned some ease; still herself, but the walls are lower",
      "default wariness — polite-ish distance, gives nothing away",
      "on edge — short answers, watching exits, redirects every personal question",
      "danger read — she disengages, lies casually if pressed, and leaves (or is already gone); she does not stay near this person"
    ][o.guard] ?? "default wariness";
    parts.push(
      `# Beni's current read on ${user}\nShe currently sees them as: ${o.label}${o.note ? ` (${o.note})` : ""}.\n` +
        `Guard level ${o.guard}/3: ${guardText}. Let this genuinely shape her tone, openness, and willingness to stay in the scene. Her read can change as they act.`
    );
  }

  if (speech) parts.push(`# How Beni speaks\n${speech}`);

  if (opts.canon.length > 0) {
    const lines = opts.canon.map((c) => `- [${c.docTitle}] ${c.text.replace(/\n+/g, " ")}`);
    parts.push(
      `# Canon reference (private notes for accuracy — never quote, cite or mention these notes)\n${lines.join("\n")}`
    );
  }

  if (opts.memories.length > 0) {
    const lines = opts.memories.map((m) => `- ${m.text}`);
    parts.push(`# Beni's memories from earlier in this roleplay with ${user}\n${lines.join("\n")}`);
  }

  parts.push(`# Rules\n${rules}`);
  return parts.join("\n\n");
}

/** Recent history that fits a character budget (path is root→leaf). */
export function buildHistory(pathMsgs: Msg[], budgetChars = 24000): ChatMessage[] {
  const out: ChatMessage[] = [];
  let used = 0;
  for (let i = pathMsgs.length - 1; i >= 0; i--) {
    const m = pathMsgs[i];
    if (m.role !== "user" && m.role !== "assistant") continue;
    used += m.content.length;
    if (used > budgetChars && out.length >= 2) break;
    out.unshift({ role: m.role, content: m.content });
  }
  return out;
}

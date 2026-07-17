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
    const ep = loadEpisodes().find((e) => e.no === opts.storyEpisode);
    if (ep) {
      parts.push(
        `# Current point in the show\nThis roleplay happens within the events of the show, just after episode ${ep.no}, "${ep.title}".` +
          (ep.synopsis ? ` What just happened: ${ep.synopsis}` : "") +
          `\nStay consistent with the show's continuity up to this point. Events after episode ${ep.no} have not happened and Beni cannot know about them.`
      );
    }
  } else {
    parts.push(
      `# Scenario\nThis is a free-form roleplay. The scene and situation come from the conversation itself. Beni's knowledge, personality and relationships match her story stage above — she cannot know events from later in the show (anything after episode ${opts.episodeCap}).`
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

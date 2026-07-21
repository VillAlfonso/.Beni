import fs from "node:fs";
import path from "node:path";
import { PROJECT_ROOT } from "../db.js";
import type { TimelineData, TimelineEpisode, Arc, Artifact, PostEntry } from "./types.js";

const DIR = path.join(PROJECT_ROOT, "data/timeline");

let cache: TimelineData | null = null;

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8")) as T;
  } catch {
    return null;
  }
}

export function reloadTimeline(): void {
  cache = null;
}

export function loadTimeline(): TimelineData {
  if (cache) return cache;
  const episodes = new Map<number, TimelineEpisode>();
  // the English dub runs 51 episodes (episodes.json is the numbering authority;
  // transcript FILES 40–52 hold episodes 39–51 — see name_transcripts.py)
  for (let no = 1; no <= 51; no++) {
    const ep = readJson<TimelineEpisode>(`ep${String(no).padStart(2, "0")}.json`);
    if (ep && ep.no === no && ep.days) episodes.set(no, ep);
  }
  cache = {
    episodes,
    arcs: readJson<Arc[]>("arcs.json") ?? [],
    artifacts: readJson<Artifact[]>("artifacts.json") ?? [],
    post: readJson<PostEntry[]>("post.json") ?? []
  };
  return cache;
}

export function episodeEntry(no: number): TimelineEpisode | null {
  return loadTimeline().episodes.get(no) ?? null;
}

export function allEpisodes(): TimelineEpisode[] {
  return [...loadTimeline().episodes.values()].sort((a, b) => a.no - b.no);
}

export function allArcs(): Arc[] {
  return loadTimeline().arcs;
}

export function allArtifacts(): Artifact[] {
  return loadTimeline().artifacts;
}

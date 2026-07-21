// Per-chat world state v2: parsing, sanitizing, and migration from the v1
// shape (relative clock + divergence enum) that older story chats carry.
import type { TimelineEpisode, WorldV2, GoalState, DivergenceEntry, ArtifactOverride } from "./types.js";

const STATUSES = new Set(["pending", "done", "missed", "abandoned"]);
const LEVELS = new Set(["minor", "major"]);

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Clamp an arbitrary object into a valid WorldV2, or null if it isn't one. */
export function sanitizeV2(raw: unknown): WorldV2 | null {
  if (!raw || typeof raw !== "object") return null;
  const w = raw as Record<string, unknown>;
  const cursor = w.cursor as Record<string, unknown> | undefined;
  if (!cursor || typeof cursor !== "object") return null;

  const goals: GoalState[] = (Array.isArray(w.goals) ? w.goals : [])
    .slice(0, 40)
    .map((g: Record<string, unknown>) => ({
      id: str(g.id),
      who: str(g.who),
      text: str(g.text),
      status: STATUSES.has(g.status as string) ? (g.status as GoalState["status"]) : "pending",
      due: typeof g.due === "number" && Number.isFinite(g.due) ? g.due : null,
      au: g.au === false ? false : Boolean(g.au),
      note: str(g.note)
    }))
    .filter((g) => g.id && g.text);

  const divergence: DivergenceEntry[] = (Array.isArray(w.divergence) ? w.divergence : [])
    .map((d: Record<string, unknown>) => ({
      day: num(d.day, 1),
      what: str(d.what),
      effect: str(d.effect),
      level: LEVELS.has(d.level as string) ? (d.level as DivergenceEntry["level"]) : "minor"
    }))
    .filter((d) => d.what)
    .slice(-20);

  const artifactOverrides: ArtifactOverride[] = (Array.isArray(w.artifactOverrides) ? w.artifactOverrides : [])
    .slice(0, 10)
    .map((o: Record<string, unknown>) => ({
      item: str(o.item),
      holder: str(o.holder),
      sinceDay: num(o.sinceDay, 1),
      note: str(o.note)
    }))
    .filter((o) => o.item && o.holder);

  return {
    cursor: {
      day: Math.max(1, num(cursor.day, 1)),
      timeOfDay: str(cursor.timeOfDay, "afternoon"),
      episode: Math.max(0, num(cursor.episode, 0))
    },
    goals,
    divergence,
    artifactOverrides,
    pressures: (Array.isArray(w.pressures) ? w.pressures : [])
      .slice(0, 6)
      .map((p: Record<string, unknown>) => ({
        who: str(p.who),
        level: Math.min(3, Math.max(0, num(p.level, 0))),
        note: str(p.note)
      })),
    events: (Array.isArray(w.events) ? w.events : []).map((e) => String(e)).slice(-12),
    beni: str(w.beni)
  };
}

/**
 * Parse a chat's stored world JSON. Detects v2 by the `cursor` key; anything
 * else with a `clock` is migrated from v1: its relative day N becomes canon
 * day `episodeStart + N - 1`, the divergence enum becomes zero-or-one ledger
 * entries, and the goals ledger starts empty (ticks fill it).
 */
export function parseWorldV2(
  raw: string | null | undefined,
  storyEpisode: number | null,
  eps: TimelineEpisode[]
): WorldV2 | null {
  if (!raw) return null;
  let w: Record<string, unknown>;
  try {
    w = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!w || typeof w !== "object") return null;
  if (w.cursor) return sanitizeV2(w);
  if (!w.clock || typeof w.clock !== "object") return null;

  const clock = w.clock as Record<string, unknown>;
  const entry = eps.find((e) => e.no === (storyEpisode ?? 0));
  const startDay = entry ? entry.days.start : 1;
  const relDay = Math.max(1, num(clock.day, 1));
  const day = startDay + relDay - 1;

  const legacyDivergence = str(w.divergence, "none");
  return sanitizeV2({
    cursor: { day, timeOfDay: str(clock.timeOfDay, "afternoon"), episode: storyEpisode ?? 0 },
    goals: [],
    divergence:
      legacyDivergence !== "none"
        ? [{
            day,
            what: `carried from the old format: divergence was "${legacyDivergence}"`,
            effect: "details live in the events list",
            level: legacyDivergence === "major" ? "major" : "minor"
          }]
        : [],
    artifactOverrides: [],
    pressures: w.pressures,
    events: w.events,
    beni: w.beni
  });
}

/** Day key/label for journal + opinion sealing; reads v2 and v1 shapes. */
export function worldDayKey(raw: string | null | undefined): { key: string; label: string } | null {
  if (!raw) return null;
  try {
    const w = JSON.parse(raw);
    const day = Number(w?.cursor?.day ?? w?.clock?.day);
    if (!Number.isFinite(day)) return null;
    return { key: `d${day}`, label: `Day ${day}` };
  } catch {
    return null;
  }
}

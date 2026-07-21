// Pure functions over the canon timeline — no I/O, no DB. Everything takes its
// data as arguments so tests run on fixtures and callers run on loadTimeline().
import type { TimelineEpisode, Arc, Artifact, ArtifactOverride, WorldV2 } from "./types.js";

export type DayEntry =
  | { episode: TimelineEpisode }
  | { between: [TimelineEpisode | null, TimelineEpisode | null] };

/** Which episode a canon day belongs to — or the gap it falls in (free days). */
export function entryFor(day: number, eps: TimelineEpisode[]): DayEntry {
  const hit = eps.find((e) => day >= e.days.start && day <= e.days.end);
  if (hit) return { episode: hit };
  let before: TimelineEpisode | null = null;
  let after: TimelineEpisode | null = null;
  for (const e of eps) {
    if (e.days.end < day) before = e;
    if (e.days.start > day) {
      after = e;
      break;
    }
  }
  return { between: [before, after] };
}

export function arcForEpisode(no: number, arcs: Arc[]): Arc | null {
  return arcs.find((a) => no >= a.episodes[0] && no <= a.episodes[1]) ?? null;
}

/** Who holds what on a given day — canon custody overlaid with AU overrides. */
export function custodyAsOf(day: number, artifacts: Artifact[], overrides: ArtifactOverride[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const a of artifacts) {
    const span = a.custody.find((c) => day >= c.fromDay && (c.toDay === null || day <= c.toDay));
    if (span) m.set(a.id, span.holder);
  }
  for (const o of [...overrides].sort((x, y) => x.sinceDay - y.sinceDay)) {
    if (day >= o.sinceDay) m.set(o.item, o.holder);
  }
  return m;
}

export interface CapabilityStatus {
  capability: string;
  active: boolean;
  why: string;
}

/** What the artifact state permits each faction to do right now. */
export function capabilitiesAsOf(day: number, artifacts: Artifact[], overrides: ArtifactOverride[]): CapabilityStatus[] {
  const holders = custodyAsOf(day, artifacts, overrides);
  const out: CapabilityStatus[] = [];
  for (const a of artifacts) {
    for (const r of a.rules ?? []) {
      const h = holders.get(r.requires.item);
      const active = h === r.requires.holder;
      out.push({
        capability: r.capability,
        active,
        why: active
          ? `${r.requires.holder} holds ${r.requires.item}`
          : `${r.requires.item} held by ${h ?? "no one"}, not ${r.requires.holder}`
      });
    }
  }
  return out;
}

/** Fresh world state for a chat starting at the START of an episode. */
export function seedWorld(ep: TimelineEpisode, arc: Arc | null): WorldV2 {
  const goals = ep.goals.map((g) => ({
    id: g.id,
    who: g.who,
    text: g.text,
    status: "pending" as const,
    due: g.due.day,
    au: false,
    note: ""
  }));
  if (arc?.beniPrime) {
    goals.unshift({
      id: `arc-prime-${arc.id}`,
      who: "Beni",
      text: arc.beniPrime.text,
      status: "pending",
      due: null,
      au: false,
      note: "arc-long goal"
    });
  }
  return {
    cursor: { day: ep.days.start, timeOfDay: ep.start.timeOfDay, episode: ep.no },
    goals,
    divergence: [],
    artifactOverrides: [],
    pressures: (arc?.watchers ?? []).map((w) => ({ who: w.who, level: w.start, note: "" })),
    events: [],
    beni: ""
  };
}

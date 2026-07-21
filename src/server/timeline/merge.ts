// Guardrails between the world-tick LLM and the stored world state. The
// model proposes a full WorldV2; code decides what it is allowed to change.
import type { WorldV2, GoalState, Artifact } from "./types.js";
import { sanitizeV2 } from "./world.js";

const MAX_DAY_JUMP = 3;
const MAX_NEW_AU_GOALS = 2;

/** pending → done|missed|abandoned · missed → done (late). Everything else is frozen. */
function statusAllowed(from: GoalState["status"], to: GoalState["status"]): boolean {
  if (from === to) return true;
  if (from === "pending") return to === "done" || to === "missed" || to === "abandoned";
  if (from === "missed") return to === "done";
  return false;
}

export function mergeTick(prev: WorldV2, proposedRaw: unknown, artifacts: Artifact[]): WorldV2 {
  const p = sanitizeV2(proposedRaw);
  if (!p) return prev;

  // clock: forward only, small steps; the episode cursor is code-owned
  const day = Math.max(prev.cursor.day, Math.min(p.cursor.day, prev.cursor.day + MAX_DAY_JUMP));
  const cursor = { day, timeOfDay: p.cursor.timeOfDay || prev.cursor.timeOfDay, episode: prev.cursor.episode };

  // goals: merge-only — canon entries survive, transitions are gated,
  // unknown ids come in as AU adaptations (bounded per tick)
  const proposedById = new Map(p.goals.map((g) => [g.id, g]));
  const goals: GoalState[] = prev.goals.map((g) => {
    const prop = proposedById.get(g.id);
    if (!prop) return g;
    const status = statusAllowed(g.status, prop.status) ? prop.status : g.status;
    return { ...g, status, note: prop.note || g.note };
  });
  const knownIds = new Set(prev.goals.map((g) => g.id));
  const fresh = p.goals.filter((g) => !knownIds.has(g.id)).slice(0, MAX_NEW_AU_GOALS);
  for (const g of fresh) goals.push({ ...g, au: true });

  // events / divergence: append-only
  const events = [...prev.events, ...p.events.filter((e) => !prev.events.includes(e))].slice(-12);
  const prevDivKeys = new Set(prev.divergence.map((d) => `${d.day}|${d.what}`));
  const newDivergence = p.divergence.filter((d) => !prevDivKeys.has(`${d.day}|${d.what}`));
  const divergence = [...prev.divergence, ...newDivergence].slice(-20);

  // custody overrides: only alongside a fresh divergence entry, only for
  // items that exist in the registry
  const itemIds = new Set(artifacts.map((a) => a.id));
  const prevOverrideKeys = new Set(prev.artifactOverrides.map((o) => `${o.item}|${o.holder}|${o.sinceDay}`));
  const newOverrides = p.artifactOverrides.filter(
    (o) => !prevOverrideKeys.has(`${o.item}|${o.holder}|${o.sinceDay}`) && itemIds.has(o.item)
  );
  const artifactOverrides =
    newDivergence.length > 0
      ? [...prev.artifactOverrides, ...newOverrides].slice(0, 10)
      : prev.artifactOverrides;

  return {
    cursor,
    goals: goals.slice(0, 40),
    divergence,
    artifactOverrides,
    pressures: p.pressures.length > 0 ? p.pressures : prev.pressures,
    events,
    beni: p.beni || prev.beni
  };
}

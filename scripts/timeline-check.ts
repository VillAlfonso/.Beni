/**
 * Post-repair gate for data/timeline/ (see spec 2026-07-21-timeline-simulator).
 * Exit 0 = gate passed. Exit 1 = violations printed. Low coverage is reported,
 * never fatal — authoring lands in batches.
 *
 * Data law: every canon fact carries evidence or is listed under
 * confidence.assumed / confidence.unknown. Unknown ok, wrong never.
 */
import { reloadTimeline, loadTimeline } from "../src/server/timeline/load.js";
import type { TimelineEpisode } from "../src/server/timeline/types.js";

const KNOWN_ARCS = new Set([
  "s0-discovery",
  "s1-infiltrator",
  "s2-vilius-agent",
  "s3-free-agent",
  "s4-change-of-heart",
  "s5-aftermath",
  "s5-knight"
]);
const TIMES = new Set(["morning", "afternoon", "evening", "night"]);
const WINDOWS = new Set(["day", "episode", "repeatable-later", "arc"]);

const errors: string[] = [];
let assumedCount = 0;
let unknownCount = 0;

function bad(where: string, msg: string): void {
  errors.push(`${where}: ${msg}`);
}

function needEvidence(where: string, what: string, evidence: unknown, assumed: boolean): void {
  if (assumed) return;
  if (typeof evidence !== "string" || evidence.trim().length < 4) bad(where, `${what} has no evidence`);
}

function checkEpisode(ep: TimelineEpisode, assumedFields: Set<string>): void {
  const w = `ep${String(ep.no).padStart(2, "0")}`;

  // days
  if (!ep.days || typeof ep.days.start !== "number" || typeof ep.days.end !== "number") {
    bad(w, "days.start/end missing");
    return;
  }
  if (ep.days.start > ep.days.end) bad(w, `days.start ${ep.days.start} > days.end ${ep.days.end}`);
  needEvidence(w, "days", ep.days.evidence, Boolean(ep.days.assumed));

  // start
  if (!ep.start) bad(w, "start missing");
  else {
    if (!TIMES.has(ep.start.timeOfDay)) bad(w, `start.timeOfDay "${ep.start.timeOfDay}" invalid`);
    if (!ep.start.situation?.trim()) bad(w, "start.situation empty");
    if (!ep.beniAbsent) {
      if (!ep.start.beni?.where?.trim() || !ep.start.beni?.doing?.trim()) bad(w, "start.beni.where/doing empty");
      needEvidence(w, "start.beni", ep.start.beni?.evidence, assumedFields.has("start.beni"));
      if (!ep.start.firstContact?.trim()) bad(w, "start.firstContact empty");
    }
  }

  if (!KNOWN_ARCS.has(ep.arcAtStart)) bad(w, `arcAtStart "${ep.arcAtStart}" is not a known arc id`);

  // goals
  for (const g of ep.goals ?? []) {
    if (!g.id?.trim() || !g.who?.trim() || !g.text?.trim()) bad(w, `goal ${g.id || "?"} missing id/who/text`);
    if (typeof g.due?.day !== "number") bad(w, `goal ${g.id}: due.day missing`);
    else if (g.due.day < ep.days.start || g.due.day > ep.days.start + 14)
      bad(w, `goal ${g.id}: due day ${g.due.day} outside [${ep.days.start}, ${ep.days.start + 14}]`);
    if (!WINDOWS.has(g.window)) bad(w, `goal ${g.id}: window "${g.window}" invalid`);
    needEvidence(w, `goal ${g.id}`, g.evidence, assumedFields.has(`goal:${g.id}`));
  }

  // actors / quarton / artifact events
  for (const a of ep.actors ?? []) {
    if (!a.who?.trim() || !a.doing?.trim()) bad(w, `actor "${a.who || "?"}" missing who/doing`);
    needEvidence(w, `actor ${a.who}`, a.evidence, assumedFields.has(`actor:${a.who}`));
  }
  if (!ep.quarton?.situation?.trim()) bad(w, "quarton.situation empty");
  else needEvidence(w, "quarton", ep.quarton.evidence, assumedFields.has("quarton"));
  for (const ev of ep.artifacts ?? []) {
    if (!ev.item?.trim() || !ev.event?.trim()) bad(w, "artifact event missing item/event");
    needEvidence(w, `artifact ${ev.item}`, ev.evidence, assumedFields.has(`artifact:${ev.item}`));
  }

  if (!ep.outcome?.trim()) bad(w, "outcome empty");

  // recall — her own memory of the episode
  if (ep.beniAbsent !== true && !ep.recall?.trim()) bad(w, "recall empty but Beni is present");
  if (ep.beniAbsent === true && ep.recall?.trim()) bad(w, "recall present but beniAbsent");

  assumedCount += ep.confidence?.assumed?.length ?? 0;
  unknownCount += ep.confidence?.unknown?.length ?? 0;
}

function main(): void {
  reloadTimeline();
  const t = loadTimeline();
  const eps = [...t.episodes.values()].sort((a, b) => a.no - b.no);

  // per-episode checks + cross-episode day monotonicity
  const goalIds = new Map<string, number>();
  let prev: TimelineEpisode | null = null;
  for (const ep of eps) {
    const assumedFields = new Set(ep.confidence?.assumed ?? []);
    checkEpisode(ep, assumedFields);
    if (prev && ep.no === prev.no + 1 && ep.days && prev.days && ep.days.start < prev.days.end)
      bad(`ep${ep.no}`, `days.start ${ep.days.start} before ep${prev.no} ended (day ${prev.days.end})`);
    for (const g of ep.goals ?? []) {
      if (goalIds.has(g.id)) bad(`ep${ep.no}`, `goal id "${g.id}" already used in ep${goalIds.get(g.id)}`);
      goalIds.set(g.id, ep.no);
    }
    prev = ep;
  }

  // artifacts registry
  const itemIds = new Set(t.artifacts.map((a) => a.id));
  for (const a of t.artifacts) {
    const spans = [...a.custody].sort((x, y) => x.fromDay - y.fromDay);
    for (let i = 0; i < spans.length; i++) {
      const s = spans[i];
      needEvidence(`artifact ${a.id}`, `custody[${i}]`, s.evidence, false);
      if (s.toDay !== null && s.toDay < s.fromDay) bad(`artifact ${a.id}`, `custody[${i}] toDay < fromDay`);
      if (i > 0) {
        const p = spans[i - 1];
        if (p.toDay === null) bad(`artifact ${a.id}`, `custody[${i - 1}] open-ended but followed by another span`);
        else if (s.fromDay <= p.toDay) bad(`artifact ${a.id}`, `custody[${i}] overlaps previous span`);
      }
    }
    for (const r of a.rules ?? []) {
      if (!itemIds.has(r.requires.item)) bad(`artifact ${a.id}`, `rule "${r.capability}" requires unknown item "${r.requires.item}"`);
      needEvidence(`artifact ${a.id}`, `rule ${r.capability}`, r.evidence, false);
    }
  }

  // episode artifact events must reference registry items (once registry is non-empty)
  if (itemIds.size > 0) {
    for (const ep of eps) {
      for (const ev of ep.artifacts ?? []) {
        if (!itemIds.has(ev.item)) bad(`ep${ep.no}`, `artifact event references unknown item "${ev.item}"`);
      }
    }
  }

  // arcs
  for (const arc of t.arcs) {
    if (!KNOWN_ARCS.has(arc.id)) bad(`arc ${arc.id}`, "unknown arc id");
    if (!arc.busy?.trim() || !arc.stakes?.trim()) bad(`arc ${arc.id}`, "busy/stakes empty");
    if (arc.beniPrime) needEvidence(`arc ${arc.id}`, "beniPrime", arc.beniPrime.evidence, false);
    for (const actor of arc.actors ?? []) {
      if (!actor.who?.trim() || !actor.motivation?.trim()) bad(`arc ${arc.id}`, `actor "${actor.who || "?"}" missing who/motivation`);
      needEvidence(`arc ${arc.id}`, `actor ${actor.who}`, actor.evidence, false);
    }
  }

  // report
  console.log(`timeline: authored ${eps.length}/52 episodes · ${t.arcs.length} arcs · ${t.artifacts.length} artifacts · ${t.post.length} post entries`);
  console.log(`facts marked assumed: ${assumedCount} · marked unknown: ${unknownCount}`);
  if (errors.length) {
    console.error(`\n${errors.length} violation(s):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log("gate: PASS");
}

main();

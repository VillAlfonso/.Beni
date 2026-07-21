# Timeline Simulator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Story mode becomes a canon-day-anchored AU simulator: per-episode day mapping, goal ledgers for Beni + factions, artifact-gated capabilities, episode-START openers, mechanical butterfly effect; isolated mode removed.

**Architecture:** New `data/timeline/` world bible (cited JSON per episode + arcs + artifacts) → new pure-function module `src/server/timeline/` (loading, day↔episode, custody/capabilities, seeding, rollover, tick guardrails) → rewritten story branch of the prompt builder, tick, routes, New Chat modal, and a new Timeline panel. Spec: `docs/superpowers/specs/2026-07-21-timeline-simulator-design.md`.

**Tech Stack:** TypeScript ESM (`"type": "module"`, imports end `.js`), Express, better-sqlite3, React 18, `tsx --test` (node:test + node:assert), no schema libs (hand-rolled validation).

## Global Constraints

- **Data law:** every canon fact in `data/timeline/` carries `evidence` (greppable transcript quote with scene tag, or corpus doc ref) or is listed in `confidence.assumed`/`unknown`. The PLAN never pre-writes canon facts — they are extracted from `data/transcripts/` + `data/corpus/` at execution time. User-stated constraints that conflict with corpus → flag, don't encode.
- Existing chats must keep working: legacy `mode='isolated'` rows stay readable; v1 world JSON auto-migrates inside parse; no SQL migrations.
- Partial coverage is a supported state: an episode without a timeline file falls back to today's synopsis-based behavior.
- All tests via `npm test` (extend script's file list); typecheck via `npm run typecheck`.
- Commit after every task (small commits; message style matches repo: `feat:`/`fix:`/`docs:` + short scope).
- Windows: paths via `path.join(PROJECT_ROOT, …)` like existing code.
- Stage ids never change (`s1-infiltrator` … `s5-knight`); DB rows reference them.

---

## Phase 1 — Data foundation

### Task 1: Timeline types + loader

**Files:**
- Create: `src/server/timeline/types.ts`
- Create: `src/server/timeline/load.ts`
- Create: `src/server/timeline/fixtures.test.ts` (shared test fixtures, exported)
- Test: `src/server/timeline/load.test.ts`
- Modify: `package.json` (test script gains new test files)

**Interfaces:**
- Produces: all timeline interfaces (below) + `loadTimeline(): TimelineData`, `reloadTimeline(): void`, `episodeEntry(no: number): TimelineEpisode | null`, `allEpisodes(): TimelineEpisode[]` (sorted), `allArcs(): Arc[]`, `allArtifacts(): Artifact[]`.

- [ ] **Step 1: Write `types.ts`** (complete file):

```ts
// Canon timeline data — the world bible under data/timeline/.
// Every fact is evidenced or explicitly assumed/unknown (see spec, "data law").

export interface DaySpan {
  start: number;            // canon day; Day 1 = first day of ep 1
  end: number;
  evidence: string;
  assumed?: boolean;
}

export interface EpisodeStart {
  timeOfDay: "morning" | "afternoon" | "evening" | "night";
  situation: string;        // director beat, plain prose (composed into *…* by opener)
  beni: { where: string; doing: string; evidence: string };
  firstContact: string;     // authored opener scene, formatted (asterisks etc.)
}

export interface CanonGoal {
  id: string;               // unique across all episodes, e.g. "ep15-con-guren"
  who: string;              // "Beni", "Vilius", "Gen/Dromus", "Knights", …
  text: string;
  due: { day: number };
  window: "day" | "episode" | "repeatable-later" | "arc";
  evidence: string;
}

export interface ActorMove { who: string; doing: string; why: string; evidence: string }

export interface ArtifactEvent {
  item: string;             // artifacts.json id
  event: string;            // "transfer" | "revealed" | "used" | free text
  from?: string; to?: string;
  evidence: string;
}

export interface TimelineEpisode {
  no: number;
  title: string;
  days: DaySpan;
  start: EpisodeStart;
  arcAtStart: string;       // stage id valid at the episode's FIRST frame (boundary
                            // episodes differ from the containing arc's range)
  goals: CanonGoal[];
  actors: ActorMove[];
  quarton: { situation: string; evidence: string };
  artifacts: ArtifactEvent[];
  outcome: string;          // canon state by episode end — divergence baseline
  recall: string;           // first-person past-tense Beni digest ("" iff beniAbsent)
  beniAbsent?: boolean;     // eps 1–13
  confidence?: { assumed: string[]; unknown: string[] };
}

export interface CustodySpan {
  fromDay: number; toDay: number | null;   // null = still holding
  holder: string; how: string; evidence: string;
}
export interface CapabilityRule {
  capability: string;                      // e.g. "deploy-minions-to-earth"
  requires: { item: string; holder: string };
  evidence: string;
}
export interface Artifact {
  id: string; name: string;
  grants: string[];
  custody: CustodySpan[];
  rules?: CapabilityRule[];
}

export interface ArcActor {
  who: string; motivation: string; alliance: string;
  powers: string[]; artifactsHeld: string[]; notes?: string; evidence: string;
}
export interface Arc {
  id: string;                              // stage id, plus "s0-discovery"
  label: string;
  episodes: [number, number];
  beniPrime: { text: string; evidence: string } | null;
  busy: string; stakes: string;            // absorbed from story-pressures.json
  watchers: { who: string; why: string; start: number }[];
  actors: ArcActor[];
}

export interface PostEntry {
  id: "s5-aftermath" | "s5-knight";
  label: string;
  daysAfterFinale: number;                 // cursor.day = ep52.days.end + this
  assumed: boolean;
  situation: string;                       // director beat for the opener
}

export interface TimelineData {
  episodes: Map<number, TimelineEpisode>;
  arcs: Arc[];
  artifacts: Artifact[];
  post: PostEntry[];
}

// ---- per-chat world state v2 ----

export interface GoalState {
  id: string; who: string; text: string;
  status: "pending" | "done" | "missed" | "abandoned";
  due: number | null;                      // canon day; null = arc-long
  au: boolean;                             // true = adaptation goal invented in this AU
  note: string;
}
export interface DivergenceEntry { day: number; what: string; effect: string; level: "minor" | "major" }
export interface ArtifactOverride { item: string; holder: string; sinceDay: number; note: string }

export interface WorldV2 {
  cursor: { day: number; timeOfDay: string; episode: number };
  goals: GoalState[];
  divergence: DivergenceEntry[];
  artifactOverrides: ArtifactOverride[];
  pressures: { who: string; level: number; note: string }[];
  events: string[];
  beni: string;
}
```

- [ ] **Step 2: Write failing loader test** `src/server/timeline/load.test.ts`. Fixtures live in `fixtures.test.ts` and are reused by later tasks:

```ts
// fixtures.test.ts — exported mini-timeline used across timeline tests
import type { TimelineEpisode, Artifact, Arc } from "./types.js";

export function ep(no: number, start: number, end: number, extra: Partial<TimelineEpisode> = {}): TimelineEpisode {
  return {
    no, title: `T${no}`,
    days: { start, end, evidence: "fx" },
    start: {
      timeOfDay: "morning", situation: `sit${no}`,
      beni: { where: "w", doing: "d", evidence: "fx" }, firstContact: `fc${no}`
    },
    arcAtStart: "s1-infiltrator",
    goals: [], actors: [], quarton: { situation: "q", evidence: "fx" },
    artifacts: [], outcome: `out${no}`, recall: `recall${no}`,
    ...extra
  };
}

export const FX_ARTIFACTS: Artifact[] = [
  {
    id: "guardians-control", name: "Control of the Guardians", grants: ["deploy-minions-to-earth"],
    custody: [{ fromDay: 1, toDay: 9, holder: "Vilius", how: "fx", evidence: "fx" },
              { fromDay: 10, toDay: null, holder: "Guardians", how: "fx", evidence: "fx" }],
    rules: [{ capability: "deploy-minions-to-earth", requires: { item: "guardians-control", holder: "Vilius" }, evidence: "fx" }]
  },
  { id: "tenkai-stone", name: "Tenkai Stone", grants: ["tenkai-fortress-access"],
    custody: [{ fromDay: 1, toDay: null, holder: "Beni", how: "fx", evidence: "fx" }] }
];

export const FX_ARC: Arc = {
  id: "s1-infiltrator", label: "The Infiltrator", episodes: [14, 25],
  beniPrime: { text: "Find the Black Dragon Key", evidence: "fx" },
  busy: "b", stakes: "s",
  watchers: [{ who: "Gen", why: "partner", start: 1 }, { who: "Eurus", why: "tasker", start: 1 }],
  actors: []
};
```

```ts
// load.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTimeline } from "./load.js";

test("loadTimeline tolerates partial coverage and returns maps", () => {
  const t = loadTimeline();                    // reads real data/timeline/ (may be sparse)
  assert.ok(t.episodes instanceof Map);
  assert.ok(Array.isArray(t.arcs));
  assert.ok(Array.isArray(t.artifacts));
});
```

- [ ] **Step 3: Run** `npx tsx --test src/server/timeline/load.test.ts` → FAIL (module not found).

- [ ] **Step 4: Write `load.ts`**:

```ts
import fs from "node:fs";
import path from "node:path";
import { PROJECT_ROOT } from "../db.js";
import type { TimelineData, TimelineEpisode, Arc, Artifact, PostEntry } from "./types.js";

const DIR = path.join(PROJECT_ROOT, "data/timeline");

let cache: TimelineData | null = null;

function readJson<T>(file: string): T | null {
  try { return JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8")) as T; }
  catch { return null; }
}

export function reloadTimeline(): void { cache = null; }

export function loadTimeline(): TimelineData {
  if (cache) return cache;
  const episodes = new Map<number, TimelineEpisode>();
  for (let no = 1; no <= 52; no++) {
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
export function allArcs(): Arc[] { return loadTimeline().arcs; }
export function allArtifacts(): Artifact[] { return loadTimeline().artifacts; }
```

- [ ] **Step 5:** Create `data/timeline/` with empty `arcs.json` (`[]`), `artifacts.json` (`[]`), `post.json` (`[]`) so the loader has a real dir. Run test → PASS. Add the two new test files to `package.json` `"test"` script.
- [ ] **Step 6: Commit** `feat: timeline data types and loader`.

### Task 2: Pure state functions (day↔episode, custody, capabilities, seeding)

**Files:**
- Create: `src/server/timeline/state.ts`
- Test: `src/server/timeline/state.test.ts`

**Interfaces:**
- Consumes: types + fixtures from Task 1.
- Produces: `entryFor(day, eps)`, `arcForEpisode(no, arcs)`, `custodyAsOf(day, artifacts, overrides)`, `capabilitiesAsOf(day, artifacts, overrides)`, `seedWorld(ep, arc)`, plus `CapabilityStatus`.

- [ ] **Step 1: Failing tests** (representative — write all four groups):

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { entryFor, custodyAsOf, capabilitiesAsOf, seedWorld } from "./state.js";
import { ep, FX_ARTIFACTS, FX_ARC } from "./fixtures.test.js";

const EPS = [ep(14, 1, 1), ep(15, 2, 3), ep(16, 6, 6)]; // gap: days 4–5

test("entryFor finds episode containing a day", () => {
  const r = entryFor(2, EPS);
  assert.equal("episode" in r && r.episode.no, 15);
});
test("entryFor reports gap days as between", () => {
  const r = entryFor(4, EPS);
  assert.ok("between" in r);
  if ("between" in r) { assert.equal(r.between[0]?.no, 15); assert.equal(r.between[1]?.no, 16); }
});
test("custody respects spans and overrides win from sinceDay", () => {
  assert.equal(custodyAsOf(5, FX_ARTIFACTS, []).get("guardians-control"), "Vilius");
  assert.equal(custodyAsOf(11, FX_ARTIFACTS, []).get("guardians-control"), "Guardians");
  const o = [{ item: "tenkai-stone", holder: "Kiiro", sinceDay: 3, note: "" }];
  assert.equal(custodyAsOf(5, FX_ARTIFACTS, o).get("tenkai-stone"), "Kiiro");
  assert.equal(custodyAsOf(2, FX_ARTIFACTS, o).get("tenkai-stone"), "Beni");
});
test("capabilities derive from custody", () => {
  const on = capabilitiesAsOf(5, FX_ARTIFACTS, []);
  assert.equal(on.find((c) => c.capability === "deploy-minions-to-earth")?.active, true);
  const off = capabilitiesAsOf(11, FX_ARTIFACTS, []);
  assert.equal(off.find((c) => c.capability === "deploy-minions-to-earth")?.active, false);
});
test("seedWorld seeds cursor, goals incl. arc prime, watcher pressures", () => {
  const e = ep(15, 2, 3, { goals: [{ id: "g1", who: "Beni", text: "x", due: { day: 2 }, window: "day", evidence: "fx" }] });
  const w = seedWorld(e, FX_ARC);
  assert.deepEqual(w.cursor, { day: 2, timeOfDay: "morning", episode: 15 });
  assert.equal(w.goals[0].id, "arc-prime-s1-infiltrator");
  assert.equal(w.goals[1].id, "g1");
  assert.ok(w.pressures.some((p) => p.who === "Eurus"));
});
```

- [ ] **Step 2:** Run → FAIL. **Step 3: Implement `state.ts`:**

```ts
import type { TimelineEpisode, Arc, Artifact, ArtifactOverride, WorldV2 } from "./types.js";

export type DayEntry =
  | { episode: TimelineEpisode }
  | { between: [TimelineEpisode | null, TimelineEpisode | null] };

export function entryFor(day: number, eps: TimelineEpisode[]): DayEntry {
  const hit = eps.find((e) => day >= e.days.start && day <= e.days.end);
  if (hit) return { episode: hit };
  let before: TimelineEpisode | null = null;
  let after: TimelineEpisode | null = null;
  for (const e of eps) {
    if (e.days.end < day) before = e;
    if (e.days.start > day) { after = e; break; }
  }
  return { between: [before, after] };
}

export function arcForEpisode(no: number, arcs: Arc[]): Arc | null {
  return arcs.find((a) => no >= a.episodes[0] && no <= a.episodes[1]) ?? null;
}

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

export interface CapabilityStatus { capability: string; active: boolean; why: string }

export function capabilitiesAsOf(day: number, artifacts: Artifact[], overrides: ArtifactOverride[]): CapabilityStatus[] {
  const holders = custodyAsOf(day, artifacts, overrides);
  const out: CapabilityStatus[] = [];
  for (const a of artifacts) {
    for (const r of a.rules ?? []) {
      const h = holders.get(r.requires.item);
      const active = h === r.requires.holder;
      out.push({
        capability: r.capability, active,
        why: active
          ? `${r.requires.holder} holds ${r.requires.item}`
          : `${r.requires.item} held by ${h ?? "no one"}, not ${r.requires.holder}`
      });
    }
  }
  return out;
}

export function seedWorld(ep: TimelineEpisode, arc: Arc | null): WorldV2 {
  const goals = ep.goals.map((g) => ({
    id: g.id, who: g.who, text: g.text, status: "pending" as const,
    due: g.due.day, au: false, note: ""
  }));
  if (arc?.beniPrime) {
    goals.unshift({ id: `arc-prime-${arc.id}`, who: "Beni", text: arc.beniPrime.text,
      status: "pending", due: null, au: false, note: "arc-long goal" });
  }
  return {
    cursor: { day: ep.days.start, timeOfDay: ep.start.timeOfDay, episode: ep.no },
    goals, divergence: [], artifactOverrides: [],
    pressures: (arc?.watchers ?? []).map((w) => ({ who: w.who, level: w.start, note: "" })),
    events: [], beni: ""
  };
}
```

- [ ] **Step 4:** Run tests → PASS. **Step 5: Commit** `feat: timeline pure state functions`.

### Task 3: Validator — the post-repair gate

**Files:**
- Create: `scripts/timeline-check.ts`
- Modify: `package.json` (add `"timeline:check": "tsx scripts/timeline-check.ts"`)

**Interfaces:** standalone CLI; exit 0 = gate passed, 1 = violations. Checks (all from spec §D): schema/field presence; `days.start ≤ days.end`; cross-episode `start ≥ prev.end`; evidence on all non-assumed facts (`days`, `start.beni`, every goal/actor/artifact-event/quarton, custody spans, rules, `beniPrime`); artifact custody chronological + non-overlapping + transfer-consistent; capability rules reference known items; goal ids globally unique; goal due within `[days.start, +14]` of its episode; `recall` non-empty wherever `beniAbsent !== true`; `arcAtStart` is a known arc/stage id. Ends with a coverage report (`authored N/52, assumed X, unknown Y`) printed always.

- [ ] **Step 1:** Implement (structure below; each check pushes `errors.push(\`epNN: message\`)`):

```ts
import { loadTimeline, reloadTimeline } from "../src/server/timeline/load.js";
// walk episodes in order, run checks, collect errors + stats, print report,
// process.exit(errors.length ? 1 : 0)
```

- [ ] **Step 2:** Run `npm run timeline:check` on the (still empty) dir → expect `authored 0/52` and exit 0 (no files = no violations, low coverage is reported not fatal).
- [ ] **Step 3: Commit** `feat: timeline validator (post-repair gate)`.

### Task 4: Author `arcs.json` + `artifacts.json` + `post.json`

**Files:**
- Modify: `data/timeline/arcs.json`, `data/timeline/artifacts.json`, `data/timeline/post.json`

**Procedure (data task — content comes from corpus at execution, per data law):**
- [ ] Read all five `data/corpus/analysis--arc-*.md` fully; read `fandom--eurus.md`, `fandom--beni.md`, `fandom--dragon-keys.md`, `fandom--dragon-cubes.md`, `fandom--tenkai-dragon-cube.md`, and guardian/fortress/stone pages as needed; grep transcripts for confirmation quotes.
- [ ] Author 6 arcs (`s0-discovery` 1–13 + five stage arcs, ranges from `stages.json`): per-arc `beniPrime` (arc1 = Black Dragon Key hardcoded; arc3 = null/free-agent), `busy`/`stakes` migrated from `story-pressures.json` (verbatim where still accurate), watchers (s1 gains **Eurus**, evidenced), actors (Vilius, Gen/Dromus, Knights, Granox, Slyger, Guardians incl. Eurus, Mr. White/Boreas, Beni) each with motivation/alliance/powers/artifactsHeld/evidence.
- [ ] Author artifacts: white + black dragon keys, dragon cubes, Tenkai Dragon, Tenkai Stone (custody: Beni from pre-day-1 → ep 47 handoff Kiiro → Guren, day numbers finalized when eps 46–48 are authored — until then `toDay: null` + note), guardians-control (Vilius's spirit seizure — find + cite the episode; rules: `deploy-minions-to-earth requires guardians-control @ Vilius`), warehouse portal.
- [ ] Author `post.json` (aftermath +3 days, knight +7 assumed).
- [ ] Verify user constraints (fidelity contract items 8–11, 14–15) against corpus; any conflict → flag to user in the session, leave field `unknown`.
- [ ] `npm run timeline:check` → exit 0. **Commit** `data: timeline arcs, artifacts, post entries (cited)`.

### Task 5: Author episodes 14–25 (arc 2 proves the format)

**Files:** Create `data/timeline/ep14.json` … `ep25.json`.

**Procedure per episode (repeat ×12):**
- [ ] Read `data/transcripts/epNN.txt` (whole file; use `epNN.json` scene/timestamps for ordering when unsure) + the `<!--ep:NN-->` blocks in `analysis--arc-2-infiltrator.md`.
- [ ] Determine `days` (night/sleep/"next day" cues; gaps minimal + `assumed`), `start` (first-frame situation; Beni's exact position; author `firstContact` per the situation+first-contact decision), `arcAtStart`, goals (Beni + factions, due days, windows), actors, quarton, artifact events, `outcome`, `recall` (first person, past tense, her voice, 3–6 sentences).
- [ ] After each file: `npm run timeline:check` → exit 0.
- [ ] Commit in batches of 3–4 episodes: `data: timeline eps 14–17 (cited)` etc.

---

## Phase 2 — Engine

### Task 6: WorldV2 parse + v1 migration

**Files:**
- Create: `src/server/timeline/world.ts`
- Test: `src/server/timeline/world.test.ts`

**Interfaces:**
- Produces: `sanitizeV2(raw: unknown): WorldV2 | null`, `parseWorldV2(raw: string | null | undefined, storyEpisode: number | null, eps: TimelineEpisode[]): WorldV2 | null`, `worldDayKey(raw: string | null): { key: string; label: string } | null` (for journal/extractor).

- [ ] **Step 1: Failing tests:** v2 roundtrip; v1 migration maps relative day N → `ep.days.start + N − 1`, enum divergence → seeded entry, missing arrays default; garbage → null; `worldDayKey` reads both shapes.
- [ ] **Step 2: Implement.** `sanitizeV2` clamps: statuses to the four allowed, `level` to minor/major, pressures ≤ 6 w/ level 0–3, events ≤ 12 (keep tail), divergence ≤ 20, goals ≤ 40, overrides ≤ 10; strings coerced. `parseWorldV2` detects v2 by `cursor` key presence; else migrates v1 (goals empty — legacy chats fill via ticks).
- [ ] **Step 3:** Tests PASS. **Step 4: Commit** `feat: world state v2 with v1 migration`.

### Task 7: Rollover + autoMiss

**Files:**
- Modify: `src/server/timeline/state.ts`
- Test: `src/server/timeline/state.test.ts` (extend)

**Interfaces:**
- Produces: `advanceCursor(world: WorldV2, eps: TimelineEpisode[]): { world: WorldV2; entered: TimelineEpisode[] }`, `autoMiss(world: WorldV2): WorldV2`.

- [ ] **Step 1: Failing tests:** day within episode → no-op; day past end into gap → episode unchanged (gap = free days); day reaching next start → advance + new goals appended pending + event line `— Episode N, "T" begins (Day D)`; multi-day skip across two episodes → both entered, goals from both; `autoMiss`: pending non-au goal past `due` → `missed` + divergence entry `canon expected … didn't happen`; arc-long (`due: null`) and `au` goals never auto-missed; done goals untouched.
- [ ] **Step 2: Implement:**

```ts
export function advanceCursor(world: WorldV2, eps: TimelineEpisode[]): { world: WorldV2; entered: TimelineEpisode[] } {
  const entered: TimelineEpisode[] = [];
  let cur = eps.find((e) => e.no === world.cursor.episode);
  let w = world;
  while (cur) {
    const next = eps.find((e) => e.no === cur!.no + 1);
    if (!next || w.cursor.day <= cur.days.end || w.cursor.day < next.days.start) break;
    const fresh = next.goals
      .filter((g) => !w.goals.some((x) => x.id === g.id))
      .map((g) => ({ id: g.id, who: g.who, text: g.text, status: "pending" as const, due: g.due.day, au: false, note: "" }));
    w = {
      ...w,
      cursor: { ...w.cursor, episode: next.no },
      goals: [...w.goals, ...fresh],
      events: [...w.events, `— Episode ${next.no}, "${next.title}" begins (Day ${next.days.start})`].slice(-12)
    };
    entered.push(next);
    cur = next;
  }
  return { world: w, entered };
}

export function autoMiss(world: WorldV2): WorldV2 {
  const newlyMissed: string[] = [];
  const goals = world.goals.map((g) => {
    if (g.status !== "pending" || g.au || g.due === null || world.cursor.day <= g.due) return g;
    newlyMissed.push(`Canon expected: ${g.text} (by day ${g.due}) — didn't happen`);
    return { ...g, status: "missed" as const, note: g.note || `canon window (day ${g.due}) passed` };
  });
  if (newlyMissed.length === 0) return world;
  const divergence = [
    ...world.divergence,
    ...newlyMissed.map((what) => ({ day: world.cursor.day, what, effect: "consequences pending", level: "minor" as const }))
  ].slice(-20);
  return { ...world, goals, divergence };
}
```

- [ ] **Step 3:** PASS. **Step 4: Commit** `feat: cursor rollover and canon auto-miss`.

### Task 8: Tick guardrails (`mergeTick`) + tick rewrite

**Files:**
- Create: `src/server/timeline/merge.ts` (+ test `merge.test.ts`)
- Modify: `src/server/memory/extractor.ts:179-241` (`maybeTickWorld`)

**Interfaces:**
- Produces: `mergeTick(prev: WorldV2, proposedRaw: unknown, artifacts: Artifact[]): WorldV2`.
- Consumes: `parseWorldV2`, `advanceCursor`, `autoMiss`, `capabilitiesAsOf`, loaders.

- [ ] **Step 1: Failing tests for `mergeTick`:** day can't rewind, can't jump more than +3 per tick; `cursor.episode` always kept from prev (code owns it); canon goals merge-only (status transitions allowed: pending→done/missed/abandoned, missed→done; done immutable; unknown-id proposals become `au: true`, max 2 per tick); events append-only; divergence append-only; artifact override accepted only when the same tick appended a divergence entry AND the item exists in the registry; pressures clamped 0–3.
- [ ] **Step 2: Implement** (pure; sanitize via `sanitizeV2`, then apply the rules above field by field, falling back to `prev` values whenever a rule rejects).
- [ ] **Step 3:** PASS; commit `feat: tick merge guardrails`.
- [ ] **Step 4: Rewrite `maybeTickWorld`:** parse via `parseWorldV2` (needs `story_episode`); build canon context from timeline (current entry via `entryFor`, arc via `arcForEpisode`, capabilities via `capabilitiesAsOf`); new system prompt (keep the conservative tone; add: goals with statuses to update; "NPC adaptations must stay inside the actor's arc motivation"; "if a canon event was blocked, choose the smallest plausible adaptation and log it as divergence"); LLM returns full JSON → `mergeTick` → `advanceCursor` → `autoMiss` → on episode advance also `UPDATE chats SET story_episode=?, episode_cap=?`. When the chat's episode has no timeline file: keep today's v1-style behavior path (fallback branch preserved).
- [ ] **Step 5:** `npm run typecheck` + full `npm test` PASS. **Step 6: Commit** `feat: world tick v2 — canon schedule, guardrails, rollover`.

### Task 9: Prompt builder rewrite (story branch)

**Files:**
- Modify: `src/server/prompt/builder.ts` (story branch of `buildSystemPrompt`, lines 173-209; `WorldState`/`parseWorld` usages)
- Modify: `src/server/routes/chat-stream.ts:63` (pass v2 world)

**Interfaces:**
- `buildSystemPrompt` opts unchanged in shape except `world?: WorldV2 | null`; builder internally imports `timeline/load` + `timeline/state`.

- [ ] **Step 1:** With timeline data present for `opts.storyEpisode`, the story branch emits, in order (exact copy in quotes; keep existing trajectory sentences where noted):
  1. `# Current point — START of episode ${no}, "${title}" — Day ${day}, ${timeOfDay} — ALTERNATE TIMELINE\n${start.situation}\n` + existing "Canon from here is a TRAJECTORY…" sentences + `Beni cannot know events beyond this point in the story.`
  2. `# Today in canon (director-only grounding)` — Beni's goal lines (`[pending] …`, phrased as her own intentions: `Beni's own missions right now (she knows these):`), `Other actors today:` from episode `actors`, `Quarton: ${quarton.situation}`, `Powers in play:` capability lines (active + inactive with `why`), `Artifacts:` custody lines from `custodyAsOf(day, …, overrides)` with `(diverged)` marker when overridden.
  3. `# This timeline so far` — divergence entries, goal-ledger lines for non-pending goals, events, pressures, `beni` line (merge with the existing world block format).
  4. `# The world's momentum (DIRECTOR-ONLY — Beni knows none of this)` — current episode `outcome` (we now start at the episode's START, so its own outcome IS the momentum) + next entry's outcome (or gap note), ≤ 400 chars each.
  5. `# The last days, as she remembers them (her own memory — first person)` — `recall` of episodes `cursor.episode − 2` and `− 1` (skip `beniAbsent`, skip missing files).
  6. "Her life right now" block now sourced from the arc (`busy`/`stakes`/watchers) via `arcForEpisode`, falling back to `loadStoryPressures()` when no arc data.
  7. Episodes 1–13: keep the existing "Beni has NOT yet arrived" note, now emitted when the entry has `beniAbsent: true` (fallback: `ep.no < 14`).
  8. No timeline file → the current synopsis-based blocks (existing code path stays).
  9. `mode === "isolated"` branch: unchanged (legacy chats only).
- [ ] **Step 2:** `npm run typecheck`; existing tests PASS; manual smoke: `npm run dev`, create a story chat on an authored episode, verify the system prompt (log it or check via a debug print) contains sections 1–5.
- [ ] **Step 3: Commit** `feat: episode-start prompt with canon schedule, ledgers, recall`.

### Task 10: Routes — story-only creation, openers, reseed, timeline endpoint, journal day source

**Files:**
- Modify: `src/server/routes/chats.ts` (POST `/chats` 21-60, PATCH 78-111; add GET `/chats/:id/timeline`)
- Modify: `src/server/memory/journal.ts:32-40` (`currentDay`), `src/server/memory/extractor.ts` (same helper)

- [ ] **Step 1: POST `/chats`:** body `{ title?, storyEpisode?, post?, userLooks? }`; `mode` ignored, always `"story"`. When `post` is `"s5-aftermath" | "s5-knight"`: stage = that id, `storyEpisode = 52`, world cursor day = `ep52.days.end + post.daysAfterFinale` (fallback day 1 when ep52 unauthored), opener = stage greeting with `post.situation` prefix. Otherwise `storyEpisode` defaults 14; stage = timeline `arcAtStart` when covered, else current range-derivation; world = `seedWorld(ep, arc)` when covered, else current v1-style seed passed through `parseWorldV2` semantics; opener = `*${start.situation}*\n\n${start.firstContact}` when covered, else current pool/greeting fallback.
- [ ] **Step 2: PATCH `storyEpisode`:** on change, reseed `world` exactly like POST (documented hard timeline jump), update `episode_cap`.
- [ ] **Step 3: GET `/chats/:id/timeline`:** 404 for missing chat; for story chats returns `{ covered, cursor, arc: {id,label}, episode: {no,title,days} | null, goals, divergence, artifactCustody: [{item,name,holder,overridden}], capabilities, pressures, events, beni }` composed from world + timeline; for legacy isolated chats returns `{ covered: false }`.
- [ ] **Step 4:** `currentDay` reads v2 cursor via `worldDayKey` (fallback to v1 clock, then real date). Extractor's rollover-seal path uses the same helper.
- [ ] **Step 5:** typecheck + tests + manual smoke (create chat on authored ep → opener is the authored scene; GET timeline returns goals). **Commit** `feat: story-only chats, episode-start openers, timeline endpoint`.

---

## Phase 3 — Web UI

### Task 11: New Chat modal rework + episodes payload

**Files:**
- Modify: `src/server/routes/misc.ts:39` (`/episodes` enriched)
- Modify: `src/web/store.tsx` (Episode type + `newChat` signature)
- Modify: `src/web/components/NewChatModal.tsx` (rewrite)

- [ ] **Step 1:** `/episodes` returns merged rows `{ no, title, covered, days?: [start, end], arc?: string, where?: string }` (timeline title wins over episodes.json; `where` = `start.beni.where`). Append nothing for post entries (client adds them from `stages`).
- [ ] **Step 2:** Store: `Episode` interface updated to the new row shape; `newChat(opts: { title?; storyEpisode?: number; post?: "s5-aftermath" | "s5-knight"; userLooks? })`.
- [ ] **Step 3:** Modal: mode toggle + stage dial deleted; one list: 52 episode options `NN — Title · Day a–b · ✓` (✓ = covered; uncovered rows show `(synopsis only)`) + two post options from stages (`Three Days After`, `The Knight`); under the select, a hint line: arc label + `where she is: ${where}`; looks fields kept as-is; Start calls `newChat`.
- [ ] **Step 4:** Manual smoke on `npm run dev` (create from covered ep, uncovered ep, post entry). **Commit** `feat: story-only new chat with episode-start picker`.

### Task 12: Timeline panel + legacy badge

**Files:**
- Create: `src/web/components/TimelinePanel.tsx`
- Modify: `src/web/store.tsx` (panel union + `loadTimeline` action + state slice)
- Modify: `src/web/components/Panels.tsx` (render case), `src/web/App.tsx` or wherever panel buttons live (add "Timeline" button for story chats), `src/web/components/Sidebar.tsx` (legacy tag on `mode==='isolated'`), `src/web/styles.css` (status chips)

- [ ] **Step 1:** Store: `panel` union gains `"timeline"`; state gains `timeline: TimelineView | null`; action `loadTimeline()` GETs `/chats/:id/timeline`.
- [ ] **Step 2:** Panel renders (read-only): header `Ep NN "Title" · Day D, time · arc · divergence count`; sections: Beni's goals (status chips: pending/done/missed/abandoned + `AU` tag), Other actors' goals, Artifacts (holder + `diverged` highlight), Powers in play (active/inactive + why), Watchers (level 0–3), Divergence ledger, Events. Empty/uncovered → "This episode isn't simulated yet — synopsis mode."
- [ ] **Step 3:** Sidebar: small `legacy` chip beside isolated chats.
- [ ] **Step 4:** Manual smoke: open panel mid-chat, see ledger move after a few exchanges. **Commit** `feat: timeline panel (spoilers visible) + legacy chat badge`.

---

## Phase 4 — Full coverage & retirement

### Task 13: Episodes 1–13 (world-only) and 26–38

Same procedure as Task 5, sources: `analysis--arc-1-discovery.md` / `analysis--arc-3-rogue.md` + transcripts + fandom pages. Eps 1–13: `beniAbsent: true`, `recall: ""`, no invented Beni activity; goals = faction goals only. Validator green after each batch; commits in batches of 3–4.

### Task 14: Episodes 39–52, recall ingestion, retirement, final pass

- [ ] Author eps 39–45 (`analysis--arc-4-free-agent.md`: free-agent era — beniPrime null; Slyger/Granox light help; the Toxsa leadership manipulation episode identified + cited; Stone secrecy) and 46–52 (`analysis--arc-5-change-of-heart.md`: Kiiro clover; ep 47 Stone handoff — finalize `tenkai-stone` custody days in `artifacts.json`; finale). Validator green; batch commits.
- [ ] Create `scripts/ingest-recall.ts` (+ npm script `ingest:recall`): upserts one doc per episode (`title: "Beni's memory — ep NN"`, `kind: "beni-recall"`, `episode: NN`) with the `recall` text as a single chunk, embedded via `embedPassages`, deletable/re-runnable (delete + reinsert by title). Run it; `POST /search` sanity query returns recall chunks under cap.
- [ ] Retire `story-pressures.json`: remove `loadStoryPressures` fallbacks (builder, extractor, chats.ts, journal.ts) once all arcs authored; delete the file; `git rm`.
- [ ] Fix `stages.json` s2 `short` wording if corpus contradicts "found the Tenkai Stone" (card says father left it — reconcile with citations from eps 26–27).
- [ ] Final: `npm run timeline:check` (52/52), `npm test`, `npm run typecheck`, manual smoke of eps 14, 26, 39, 47, 52 openers + a day-rollover conversation. **Commit** `data: full 52-episode timeline coverage; retire story-pressures`.

---

## Self-review (done at write time)

- **Spec coverage:** contract items 1–17 → tasks: 2 (Task 10/11), 3 (Tasks 1–5), 4 (Tasks 5/9/14 recall), 5 (Tasks 5/7/8), 6 (Tasks 5/10), 7 (Tasks 4/5/9), 8–11 (Task 4 + 5), 12–13 (Tasks 7/8), 14–15 (Task 4 arcs + 13/14 data), 16 (Task 4), 17 (whole). Isolated removal: 10/11/12. Validator: 3. Panel: 12. Migration: 6.
- **Placeholders:** data-task content is extraction-by-procedure by design (data law forbids pre-written canon facts); all code tasks carry code.
- **Type consistency:** `WorldV2.cursor.episode` (not `ep`); `GoalState.due: number | null`; `entryFor` returns `DayEntry`; loader name `episodeEntry`; fixtures exported from `fixtures.test.ts`.

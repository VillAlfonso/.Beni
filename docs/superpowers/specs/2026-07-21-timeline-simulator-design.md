# Timeline Simulator — canon days, goals, and the butterfly effect

**Date:** 2026-07-21 · **Status:** approved (approach + section A explicitly; B–D by "let's do it")
**Predecessor:** `2026-07-17-beni-rp-design.md` (base RP system: stages, story mode, world tick, RAG)

Turn story mode into a grounded alternate-universe simulator of Tenkai Knights: every
episode mapped to canon in-story days, every actor carrying canon goals per day/arc,
artifact custody gating faction power, chats opening at the exact start of a chosen
episode, and player interference rippling forward mechanically. Isolated mode is removed.

## Fidelity contract (the user's requirements, verbatim-faithful)

1. ~~Install story/lore-consistency plugins~~ — DONE: `creative-writing@grey-haven-plugins` (user scope, active next session)
2. Remove isolated mode; story mode only remains
3. Corpus-derived episode→day mapping; the system knows what happens each day; timeline changes ripple forward
4. Beni recalls what she did in the episodes — "it has to be her as much as possible"
5. Per-episode/day canon goals; a missed mission reshapes the story after = the AU premise
6. Chats start at the START of the chosen episode with her exact canon position/activity ("make it really accurate")
7. AU grounded in world state: Quarton battle situation, Vilius's plans, the Guardians
8. Motivations: Knights = answer the call, stop Vilius's plans; Gen's villain arc = find the Black Dragon Key, take its power for himself
9. Artifact-gated power: Granox & Slyger reach Earth only because Vilius controls the Guardians — seized by his lingering spirit after his first-arc disassembly
10. Beni holds the Tenkai Fortress key (the Stone) from season 1's start until end of ep 47, then Kiiro → Guren
11. Eurus = extra watcher during the Black Dragon Key arc (he tasks the hunt)
12. Adaptability: a goal missed one day can still be done another
13. Enemies AND allies adapt their missions too — butterfly effect
14. Pre-Key: the Black Dragon Key is Beni's hardcoded goal
15. Post-Key/Vilius-defeat era: free agent — no concrete goal; light help to Slyger & Granox on Earth; small trouble for the Knights (the Toxsa leadership manipulation); Stone kept secret; her absence barely bends the story
16. Per-arc dossiers for every actor: actions, powers, motivations, alliances, artifacts
17. Net result: a real simulator — what would actually happen if you got into the world of Tenkai Knights

**User decisions (2026-07-21):** evidence-based day ranges (not forced 1 ep = 1 day) ·
openers = situation + first contact · cited draft with spot-audit (wire in immediately,
every fact evidenced or marked assumed/unknown) · Timeline panel with spoilers fully
visible · Approach 1 (structured simulator).

**Data law (standing):** unknown is acceptable, wrong is never acceptable. No unaudited
LLM output enters the system: every extracted fact carries greppable evidence, the
validator is the post-repair gate, user spot-audits and fixes land on sight. Where a
user-stated constraint conflicts with the corpus, flag it — never encode silently.

## Section A — The world bible: `data/timeline/`

One file per episode (`ep01.json`…`ep52.json`) plus `arcs.json`, `artifacts.json`,
`post.json`. Sources: `data/transcripts/epNN.{txt,json}` (speaker/scene/timestamps),
`data/corpus/analysis--arc-*.md` (ep-tagged beats), `data/corpus/fandom--*.md`.

### Episode file schema

```jsonc
{
  "no": 15, "title": "…",                    // title verified against corpus
  "days": { "start": 16, "end": 17,          // canon days; Day 1 = first day of ep 1
            "evidence": "ep15: Guren repairs her shoes overnight → a night passes",
            "assumed": false },
  "start": {
    "timeOfDay": "morning",                  // morning|afternoon|evening|night
    "situation": "Director beat: what is in motion at the first frame (cited).",
    "beni": { "where": "…", "doing": "…", "evidence": "[earth] Beni: 'Target in sight.'" },
    "firstContact": "*authored opener — her first canon-plausible Earth encounter*"
  },
  "goals": [ { "id": "ep15-con-guren", "who": "Beni", "text": "…",
               "due": { "day": 16 }, "window": "repeatable-later", "evidence": "…" } ],
  "actors": [ { "who": "Gen/Dromus", "doing": "…", "why": "…", "evidence": "…" } ],
  "quarton": { "situation": "battle state / who holds the field", "evidence": "…" },
  "artifacts": [ /* only custody/state CHANGES this episode, with evidence */ ],
  "outcome": "What canon had happened by episode's end — the divergence baseline.",
  "recall": "First-person, past-tense Beni digest of what SHE did/learned this episode.",
  "beniAbsent": false,                       // true for eps 1–13 (recall empty)
  "confidence": { "assumed": ["timeOfDay"], "unknown": [] }
}
```

Semantics:
- **Days are evidence-derived, gaps included.** Canon skips time (ep 14 opens on "feels
  like weeks since the last battle"): gaps get a minimal consistent value, marked
  `assumed`, quote preserved. Weekdays/seasons unknown → stay unknown.
- Consecutive episodes may share a day (`start == prev.end`); an episode never starts
  before the previous one ends.
- **Gap days** (days between one episode's end and the next's start) are free days: no
  new canon goals; the world's momentum is the next episode.
- Eps 1–13: full world/faction/day data, `beniAbsent: true`, no invented Beni activity
  (she holds the Stone; her whereabouts are unshown).
- `evidence` = short quote + scene tag, greppable in `data/transcripts/` or a corpus
  doc ref (`fandom--eurus.md`, `analysis--arc-2 <!--ep:15-->`).

### `arcs.json`

Six arcs: `s0-discovery` (1–13, world-only) + the five existing stage ids (unchanged so
`chats.stage_id` stays valid). Per arc: `{ id, label, episodes: [a, b], beniPrime,
busy, stakes, watchers: [{who, why, start}], actors: [{who, motivation, alliance,
powers, artifactsHeld, notes, evidence}] }`.
- `beniPrime`: arc 1 = the Black Dragon Key (hardcoded); arc 3 = none — free agent.
- Watchers: **Eurus joins s1-infiltrator** (the Key hunt's tasker), evidenced.
- This file **absorbs and retires `story-pressures.json`** (busy/stakes/watchers move
  here; one source of truth). `stages.json` stays for labels/greetings/caps.

### `artifacts.json`

Registry of dragon keys (white/black), dragon cubes, Tenkai Stone/Fortress key, Tenkai
Dragon, Guardians-control, portals: `{ id, name, grants: [capability], custody:
[{fromDay, toDay|null, holder, how, evidence}], rules: [{capability, requires:
{item, holder}, evidence}] }`.
- Custody segments per item: chronological, non-overlapping, transfer-consistent.
- Example rule: `deploy-minions-to-earth requires guardians-control held by Vilius`
  (rooted in the spirit-possession event; cited before encoding).
- The engine computes what each faction CAN do from what it holds — an AU where the
  Guardians are freed automatically grounds Granox and Slyger.

### `post.json`

The two post-series entries (`s5-aftermath` "Three Days After", `s5-knight` "The
Knight") as pseudo-episodes with days continuing after ep 52's end. Authored greetings
kept from `stages.json`.

## Section B — Engine

### New module `src/server/timeline/`

- `types.ts` — interfaces above + WorldState v2.
- `load.ts` — loads/validates/caches `data/timeline/`; tolerant of partial coverage
  (episodes without files fall back to legacy synopsis behavior so data authoring can
  land in batches).
- `state.ts` — pure functions: `dayRangeOf(ep)`, `entryFor(day)` (episode, or
  `{between}` for gap days), `custodyAsOf(day, overrides)`, `capabilitiesAsOf(...)`,
  `seedWorld(ep)`, `advanceCursor(world)` (rollover), `autoMiss(world)` (draft misses).

### WorldState v2 (per-chat `chats.world` JSON)

```jsonc
{
  "cursor": { "day": 16, "timeOfDay": "morning", "episode": 15 },
  "goals": [ { "id": "ep15-con-guren", "who": "Beni", "text": "…",
               "status": "pending",            // pending|done|missed|abandoned
               "due": 16, "au": false, "note": "" } ],
  "divergence": [ { "day": 16, "what": "…", "effect": "…", "level": "minor" } ],
  "artifactOverrides": [ { "item": "tenkai-stone", "holder": "Kiiro",
                           "sinceDay": 40, "note": "gave it early" } ],
  "pressures": [ { "who": "Gen", "level": 1, "note": "" } ],
  "events": [ "…" ],
  "beni": "one line on her condition"
}
```

- `missed` = the canon window passed; the goal REMAINS attemptable later (adaptability)
  — a late completion sets `done` + note, the divergence entry records the shift.
- `au: true` marks adaptation goals the tick creates for NPCs (bounded, see below).
- v1 → v2 migration inside `parseWorld`: relative `clock.day` N maps to
  `episodeStartDay + (N − 1)`; enum divergence becomes `[]` or one seeded entry;
  missing fields default. No DB migration (JSON column).

### Seeding (chat creation at episode N)

Cursor = N's `days.start` + `start.timeOfDay`. Goals = N's goals + the arc's
`beniPrime` (id `arc-prime-*`, window `arc`). Pressures = arc watchers at `start`
levels. Divergence/overrides empty. Earlier canon is intact by definition (divergence
none at second zero).

### Tick v2 (`maybeTickWorld` rewrite)

Single utility-LLM call, richer inputs, code-enforced guardrails:
- Input: WorldState v2 + today's canon schedule (episode goals/actors/outcome/quarton)
  + capability lines + arc dossier extract + excerpt.
- LLM may: advance timeOfDay/day (scene time only), update goal `status`/`note`,
  raise/lower pressures, append 1–2 short events, append divergence entries, propose
  artifact overrides, propose at most 1 `au` adaptation goal per actor — and NPC
  adaptations must stay inside the actor's arc motivation.
- Code enforces: day monotonic; goal set merge-only (never delete canon goals);
  events append-only; custody override requires a same-tick divergence entry;
  adaptation may not grant a capability the artifact state forbids; caps on array
  sizes.
- After tick, code (not LLM) runs `advanceCursor`: while `cursor.day >
  days.end(currentEp)` → advance to the entry containing/next-after the day, append
  its goals as pending, update `chats.story_episode` AND `chats.episode_cap` (the
  spoiler cap follows the cursor), append event "— Episode N, 'Title' begins (Day D)".
  Then `autoMiss`: canon goals past due+window and not done → `missed` + drafted
  divergence entry ("canon expected X by day D — didn't happen"), which the next tick
  narrates consequences for.

### Recall — "it has to be her"

- Prompt always injects the `recall` digests of episodes `cursor−2 … cursor−1`
  (skipping `beniAbsent`) as her own recent past, first person, verbatim from data.
- Post-audit, recall digests are ingested as corpus chunks (`kind: "beni-recall"`,
  episode-tagged) via a small `scripts/ingest-recall.ts` → the existing episode-capped
  RAG surfaces older lived history on demand. Merch exclusion unchanged.

## Section C — Prompt, openers, isolated-mode removal

### Prompt (story branch of `buildSystemPrompt`, rewritten)

1. `# Current point — START of episode N "Title" (Day D, <time>) — ALTERNATE TIMELINE`
   + `start.situation` + existing trajectory-not-script language.
2. `# Today in canon` — Beni's goals (phrased as her own intentions — she knows her own
   missions), actor moves, Quarton situation, 2–4 capability lines, artifacts in play.
3. `# This timeline so far` — events, compact goal ledger (`[done]/[missed]…`),
   divergence entries, pressures, her condition line.
4. `# The world's momentum (director-only)` — THIS episode's `outcome` (rest-of-episode
   trajectory; we start at the episode's start now) + next entry's outcome, brief.
   Replaces truncated fandom synopses.
5. `# What she remembers from the last days` — recall digests (B above).
6. "Her life right now" block sources busy/stakes/watchers from `arcs.json`.
7. Eps 1–13 note (Beni not yet in Benham) kept, now driven by `beniAbsent`.
8. Isolated branch retained ONLY for legacy chats (existing rows keep rendering).

### Openers

POST /chats composes the greeting from the episode file: `situation` paragraph
(director-voice italics) + `firstContact` scene. Random per-stage pools
(`scenarios.json`) retire for story chats; file kept only as fallback for episodes
whose timeline file doesn't exist yet. Post-series entries use their authored
greetings.

### Isolated-mode removal

- POST /chats: mode forced `"story"`; `storyEpisode` required (default 14); body
  `mode` ignored.
- `NewChatModal`: toggle + stage dial deleted; episode picker (52 + 2 post entries)
  showing `Ep NN — Title · Day D–D · <arc label>` + a one-liner of where she is
  (`start.beni.where`); "✓ simulated" badge when the timeline file exists; looks
  fields kept.
- PATCH `storyEpisode` reseeds the world to the new episode (messages kept; documented
  as a hard timeline jump).
- Legacy isolated chats: rows keep `mode='isolated'`, still readable/usable, badged
  "legacy" in the sidebar. No data migration, no deletion.
- `journal.currentDay` story path reads `cursor.day` (labels unchanged); isolated
  legacy path unchanged.

## Section D — UI, validator, tests

### Timeline panel (new tab in `Panels.tsx`, spoilers fully visible)

Served by GET `/chats/:id/timeline` (world + timeline data composed server-side):
header (Ep · title · Day · time · arc · divergence count) · Beni goals with status
chips · faction moves · artifact custody (canon vs override highlighted) ·
capabilities · pressures · divergence ledger · events. Read-only v1; steering stays in
the OOC director channel.

### Validator — the post-repair gate

`scripts/timeline-check.ts` (`npm run timeline:check`), hand-rolled checks, non-zero
exit on violation:
- schema/field presence per file; day ranges valid; cross-episode monotonicity
  (`start ≥ prev.end` unless same-day continuation `start == prev.end`);
- every non-assumed fact evidenced; `confidence` lists consistent;
- artifact custody per item chronological, non-overlapping, transfer-consistent;
  capability rules reference known items;
- goal ids unique; due within/after own episode days;
- `recall` present wherever `beniAbsent != true`;
- coverage report: authored/52, assumed count, unknown count.

### Tests (`tsx --test`, joins existing suite)

`src/server/timeline/timeline.test.ts` on a small fixture timeline: day↔episode lookup
incl. gap days; custody/capabilities with and without overrides; WorldState v2 parse +
v1 migration; seeding; rollover across a multi-day skip spanning two episodes + a gap;
autoMiss drafting. Plus updating any existing tests touched by builder changes.

## Extraction workflow (the long pole)

Batch by arc; per episode: arc-analysis segment + transcript (txt primary, json
timestamps for scene order) + fandom page → author `epNN.json` → `timeline:check`
green → continue. User constraints verified in their arc (Eurus tasker — arc 1 data;
Vilius spirit → Guardians chain; Stone custody until ep 47 handoff; Toxsa leadership
manipulation; Slyger/Granox Earth help). Conflicts between user statement and corpus
are flagged to the user, never silently encoded.

## Phases (each shippable)

1. **Data foundation** — schema types + validator + `arcs.json` + `artifacts.json` +
   episodes 14–25 authored (richest arc proves the format).
2. **Engine v2** — timeline module, WorldState v2 + migration, seeding, tick rewrite,
   rollover, dynamic cap, recall injection, tests.
3. **Openers + isolated removal** — POST/PATCH changes, NewChatModal rework, prompt
   rewrite wired to data, fallbacks for uncovered episodes.
4. **Timeline panel** — endpoint + UI tab.
5. **Full coverage** — episodes 26–52 and 1–13 (world-only), recall ingestion script,
   `story-pressures.json` retirement, polish.

## Out of scope (YAGNI, explicit)

Editing world state from the panel (OOC channel covers steering) · multi-character
playable POVs · Quarton-side player scenes engine (fiction handles them) · re-chunking
the whole KB · any change to bond/opinion/journal systems beyond day-source.

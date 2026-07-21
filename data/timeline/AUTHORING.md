# Authoring timeline episodes

One file per episode: `epNN.json` (dub episode number, zero-padded). The gate:

```
npm run timeline:check     # must say "gate: PASS" before you're done
npm run ingest:recall      # after adding/editing recall digests (then restart the app)
```

## ⚠ The numbering trap (read this first)

The app and these files use **dub episode numbers (1–51)** — `data/episodes.json` is the
authority. The transcript FILES drift from that late in the run:

| Episode (dub) | Transcript file |
|---|---|
| 1–38 | `data/transcripts/ep01.txt` … `ep38.txt` (same number) |
| 39–51 | `data/transcripts/ep40.txt` … `ep52.txt` (**file = episode + 1**) |
| — | `ep39.pending-dub38.*` is a quarantined suspected duplicate — don't use it as ep 39 |

So: authoring **episode 46 "Heart Turns to Stone"** means reading **`ep47.txt`**.

## The data law

Unknown is acceptable; wrong is never. Every fact carries `evidence` — a short
greppable transcript quote (`ep47: 'It's for you.'`) or a corpus doc reference
(`analysis--arc-5 <!--ep:46-->: '…'`). What you can't evidence goes in
`confidence.assumed` (chosen value, reasoning recorded) or `confidence.unknown`
(no value asserted). Never silently invent.

## Field-by-field

```jsonc
{
  "no": 29, "title": "…",                 // title from data/episodes.json
  "days": { "start": 56, "end": 56,       // canon days — see Day rules below
            "evidence": "…", "assumed": true },
  "start": {
    "timeOfDay": "morning",               // morning|afternoon|evening|night
    "situation": "Director beat: what's in motion at the episode's FIRST frame. Plain prose (the opener wraps it in *…*).",
    "beni": { "where": "…", "doing": "…", "evidence": "…" },
    "firstContact": "*Her first canon-plausible Earth encounter — a scene where a stranger could actually run into her. Formatted with asterisks.*"
  },
  "arcAtStart": "s2-vilius-agent",        // stage id valid at the FIRST frame
                                          // (breakup mid-episode ⇒ old arc at start)
  "goals": [ { "id": "ep29-slug", "who": "Beni", "text": "…",
               "due": { "day": 56 },      // within [days.start, days.start+14]
               "window": "episode",       // day|episode|repeatable-later|arc
               "evidence": "…" } ],
  "actors": [ { "who": "Vilius", "doing": "…", "why": "…", "evidence": "…" } ],
  "quarton": { "situation": "battle state / who holds the field", "evidence": "…" },
  "artifacts": [ /* only CHANGES this episode — and mirror them in artifacts.json! */ ],
  "outcome": "What canon had happened by episode's end — the divergence baseline AND the momentum text the prompt shows.",
  "recall": "First-person, past-tense, HER voice. See Recall discipline.",
  "beniAbsent": false,                    // true only for eps 1–13 (then recall must be "")
  "confidence": { "assumed": ["…"], "unknown": ["…"] }
}
```

- **Goal ids are globally unique** (prefix with `epNN-`). `who` values in use:
  `Beni`, `Gen/Dromus`, `Vilius`, `Knights`, `Granox & Slyger`, `Guardians`,
  `Eurus`, `Mr. White`, `Wakamei`, `Kiiro`, `Beast lords (Orangor, Scorpidon)`.
- **firstContact** must be playable: if she's on Quarton at the first frame, the
  situation line says so and firstContact lands at her first plausible Earth
  moment (coming back through the warehouse, etc.).

## Day rules

- Day 1 = first day of ep 1. **Standing anchor (recorded in ep14's confidence):**
  arc 1 = days 1–13 (one day per episode), ep13→14 gap = 14 days → ep 14 starts day 27.
- Derive day spans from transcript cues: "tomorrow", overnight events, second
  school scenes, meals. No cue ⇒ next episode = next day, `assumed: true`.
- Consecutive episodes may share a day (`start == prev.end` — continuations);
  an episode may never start before the previous one ends.
- Weekday grid: **day 37 = Sunday** (stated on screen, ep 19). "It's the weekend"
  or a school scene must fit the grid — that's how days 39–42 became canonical
  gap days. Gap days are FREE days (the engine treats them as unscheduled).
- Where the story stands as of ep 28: day 55. Days so far —
  14:27–28 · 15:29–30 · 16:31–32 · 17:33–35 · 18:35–36 · 19:37 · 20:38 ·
  21:43 · 22:44 · 23:44 · 24:45–46 · 25:46 · 26:46 · 27:53–54 · 28:54–55.

## Recall discipline (the most important rule)

`recall` is what SHE experienced or plausibly heard — nothing else:

- On-screen Beni scenes: fair game, in her voice, with her verbatim lines woven in.
- World-scale events (a fortress lifting into the sky): she may know OF them,
  hedged ("word is…", "you don't miss a thing like that").
- Off-screen episodes: keep it thin. What she did that day is UNKNOWN — say
  nothing specific, list it under `confidence.unknown`. Never invent private
  scenes, conversations, or feelings that aren't anchored to shown beats.
- Never give her knowledge she couldn't have (enemy war-room scenes, private
  conversations she wasn't in). If she learns it later, later episodes' recall
  can say so.

## Artifact custody duties

If an artifact changes hands/state in your episode, update **both**:
1. the episode's `artifacts` array (the event, with evidence), and
2. `artifacts.json` custody spans (close the old span at `day-1`, open the new
   one at `day`). Spans must stay chronological and non-overlapping — the
   validator enforces it. Same-day multi-transfers: pick the end-of-day holder
   for the span and tell the full story in `how`.

Open custody threads waiting on future episodes are marked
`PENDING AUTHORING` inside `how` — search artifacts.json for that phrase.

## After authoring

1. `npm run timeline:check` → gate: PASS
2. `npm run ingest:recall` → embeds new/edited recalls (restart the app after)
3. Commit. The app picks up new episode files on server restart
   (`reloadTimeline()` is also called by the validator each run).

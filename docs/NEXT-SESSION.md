# Next-session briefing (written 2026-07-18 — read me first)

## STATUS: accurate pass DONE — 52/52 eps have work/epNN.aligned.json (pyannote speaker-split,
word-level). Beni enrolled from ep14. Remaining tail, in order:
1. User labels Kiiro (review_spk/ep46 or 47 label.html) + optionally Wakame (ep19); rerun
   `make_label_sheet.py` first so sheets show the new aligned speakers.
2. `name_transcripts.py` (all) → `find_by_context.py` (proposes Guren's Dad/Wakame from
   dialogue cues — user's idea) → confirm → re-run name_transcripts → `beni_frames.py` →
   `npm run ingest` → leak-test (stage-1 chat must know nothing of Kiiro) → `npm run export-lora`.

## Attribution accuracy (user audited samples — read this)
User caught real errors: mid-sentence tears at turn boundaries ("See? One size / almost fits
all"), and unenrolled voices (Corekai soldiers, the boys) matching "Guren". Fixes so far:
MATCH_THRESHOLD now 0.60 (wrong names → honest Unknown; 70% named, Beni 309 confident lines).
`repair_attribution.py` exists but is **experimental — do NOT run it with the local 24B**
(tested on ep15: 74 unaudited edits, missed the target case; reverted from pre_repair/).
**The real repair belongs to THIS session's world-bible read-through**: while reading each
arc's transcript, fix attribution inline (dialogue logic: who's addressed, who acts) — same
reading, two outputs. Back up to data/transcripts/pre_repair/ first; diff after. Labeling the
three boys + Kiiro + ep49 JP cast remains the single biggest accuracy lever — do it FIRST.

## How to build the world bible + deepen Beni (user will drive this)
- **World bible**: read transcripts by ARC (1–13, 14–25, 26–38, 39–45, 46–52), sampled not
  dumped. Per arc write `data/corpus/analysis--arc-N.md` with frontmatter like the fandom
  files (`kind: analysis`) and **`<!--ep:N-->` before every block** — that tag is what keeps
  episode-capping honest; an untagged spoiler block would leak into early-stage Beni. Cover:
  events, who-knows-what-by-when, factions/mechanics, Beni's beats + exact quotes. Re-ingest.
- **Deepen Beni**: `src/server/prompt/builder.ts:83` loads `character/beni/stages/<id>.md`
  per stage — **these files don't exist yet** (each stage is one sentence today). Write the
  five (s1-infiltrator … s5-knight) from her actual transcript lines per era + frames from
  `beni_frames.py` (mannerisms — LOOK at them); each file ends with "what she does NOT know
  yet". Add new verbatim lines to speech.md. Never put late-arc facts in card.md (always-on).
- Kickoff prompt for a fresh session: "Read docs/NEXT-SESSION.md and do the remaining tail,
  then the world bible + stage files exactly as specified there. Verify caps by leak-test."

## Overnight results (chain finished ~03:40, all verified)
- **52/52 transcribed** → `pipeline\transcribe\work\epNN.segments.json`; 49–52 confirmed
  Japanese (0.90–0.98) and whisper-translated to English. KoboldCpp restarted, API answering.
- **Labeling clips READY** for eps 2/18/33/46/49 → `review\epNN\`, now **12–27 clusters each**
  (was 130–300 — fixed: cluster only on ≥2s clips, agglomerative cut 0.72; see commit 2a2586c).
  Each cluster = up to 3 `SNN_sampleN.wav`. Optional further upgrade if labels still bleed:
  free HF token + `pip install pyannote.audio` + accept speaker-diarization-3.1 terms + set
  HF_TOKEN → diarize_match auto-uses pyannote. Not required; token-free path is labelable now.
- **CORRECTION (morning 2026-07-18): eps 6, 14–17, 47 ARE truncated downloads** — the
  original size flag was right. Proof: ep14.mp4 = 8.2MB vs healthy ~55MB; ffmpeg reports
  "partial file" and extracts only 2.9 of 21.5 min; container header lies about duration so
  players show a full seekbar. Vocal isolation could NOT recover them (nothing to recover past
  ~3 min). **User must re-download these 6** (14–17 = Beni's debut arc, high value). The
  isolation/clustering work below still stands for the other 46 healthy episodes.
- (superseded) earlier theory that these were compression/music-bed VAD failures — WRONG:
  `isolate.py`
  (demucs htdemucs vocal separation, GPU) → `work/epNN.vocals.wav`; transcribe.py &
  diarize_match.py auto-prefer it. Pilot ep14 recovered. A background job is isolating these
  6 + the 5 labeling eps and regenerating clean clips (crushed-ep artifacts already purged).
  **Morning: verify that job finished, then run the full pipeline with isolation for all 52**
  (`isolate.py` then re-`transcribe.py`) so every episode benefits, not just the noisy ones.
- Frame capture (`beni_frames.py`) now samples 3 frames/line (0.2/0.5/0.8), not 1 — live-
  watching ep22 showed single midpoint frames land on reaction shots / back of her head.
  The mannerisms-interpretation pass (LOOK at her frames, write how she carries herself)
  is real and demonstrated but GATED on labeled transcripts → gated on user's voice labeling.

For the next Claude session (any model). Phase 1 + infra are DONE and live — do not redo or
"verify" them from scratch. Project memory index: `~\.claude\projects\C---Beni\memory\MEMORY.md`.

## Live state
- App http://localhost:3001 · public **https://beni.quert.site** (access key `beni-HMXN11g7cx1v`)
  · `start-all.bat` boots model+app+tunnel. Model: Cydonia 24B v4.3 via KoboldCpp, port 5001.
- Episodes: `C:\.webdownloader\ep1..52` — **root files only** (user: ignore the subfolders there).
  `data\episodes` is a junction to it. All 52 files verified usable (small ones = low video
  bitrate, audio is fine 96kbps AAC). **49–52 = Japanese audio**; their embedded .ass subs are
  Chinese machine-translation garbage — do not use them; `transcribe.py` already whisper-translates.
- Overnight chain (launched 2026-07-18 ~00:30): all-episode transcription + labeling clips for
  eps 2/14/33/46/49 → `pipeline\transcribe\review\epNN\*.wav`. Log: `logs\` + task output.

## Morning workflow
1. **User listens** to `review\epNN\` clips (eps 2/18/33/46/49 ready) and labels each cluster once:
   `pipeline\transcribe\.venv\Scripts\python.exe pipeline\transcribe\enroll.py --episode 18 S03=Beni S01=Guren …`
   Multiple clusters CAN be the same person (`S03=Beni S07=Beni` merges) — expected, not a bug.
   Names to expect: Guren, Ceylan, Toxsa, Chooki, Gen, Beni, Mr. White, Vilius, Boreas, Kiiro
   (late eps), Granox, Slyger. Eps 49–52 store separate JP profiles automatically (different VAs).
   Note: ep14 clips are gone (its old cluster npz was purged with the crushed-audio artifacts);
   ep18 replaced it as a stage-1 labeling episode. Re-run diarize on 14 after it's re-isolated.
2. `…python.exe pipeline\transcribe\diarize_match.py` — all episodes auto-label; any voice it
   can't match exports more clips (enrollment is incremental — new characters appear over the
   series, label them as they surface; user explicitly flagged this).
3. `…python.exe pipeline\transcribe\scene_tag.py` — adds quarton/quarton-battle/earth tags
   (user's heuristic: tenkai names ⇒ Quarton).
3b. `…python.exe pipeline\transcribe\beni_frames.py` — frame per Beni line + index.json
   pairing frame ↔ her words ↔ scene (user's idea: study her expressions/body language;
   feeds the P4 image LoRA and the world bible's mannerisms section — LOOK at a sample
   of line+frame pairs from pivotal scenes and write what you see).
4. `npm run ingest` — transcripts → RAG. Then leak-test: stage-1 chat must not retrieve >ep25.
5. `npm run export-lora` (gates on ≥300 real Beni lines) → then `docs\LORA-TEXT.md` path.
6. After ingest works: read transcripts (SAMPLED — watch token spend) + all 51 synopses and
   write the "world bible" the user asked for — an analyst/superfan's doc of arcs, factions,
   relationships, per-stage world state → `data\corpus\analysis--*.md` + re-ingest.

## Open questions
- JP files ep49–52 vs dub numbering (51 eps): after transcription, align against
  `data\episodes.json` synopses; JP may be offset by one. Only change stage ranges on evidence.
- User's country: asked (for legal episode availability), never answered — don't push.

## Rules that already bit us (do not relearn these the hard way)
- GPU is 16GB: KoboldCpp (~14.5GB) and whisper/ECAPA can't coexist — kill kobold first,
  `start-model.bat` after (run_all.ps1 does both).
- torch MUST be the cu128 build (RTX 5060 Ti = Blackwell). cu124 = "no kernel image".
- cloudflared: every Beni command passes `--config %USERPROFILE%\.cloudflared\beni-config.yml`
  — bare commands load the Revelator project's config and hijack routes.
- Beni is NOT the boys' classmate (pinned in `character\beni\card.md`). English dub canon.
- Persona = card (always-on identity) + RAG (retrieved facts, episode-capped) + future LoRA
  (voice only). They're layers, not redundancy — don't collapse them.
- git via PowerShell 5.1 can exit 255 on success — check `git log`, use Git Bash.

## User preferences
Hobbyist ("quertgamer"), wants Beni "exactly like Beni" — perfection over speed, verify
everything. Keep replies readable, not jargon. Branch UI is hidden behind the ⑂ header toggle
by default (chats stay "pure") — don't resurface it without being asked. Token-frugal: heavy
lifting belongs in local scripts, not in-context.

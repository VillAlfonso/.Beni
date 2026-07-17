# Next-session briefing (written 2026-07-18 — read me first)

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
1. **User listens** to `review\epNN\` clips and labels each cluster once:
   `pipeline\transcribe\.venv\Scripts\python.exe pipeline\transcribe\enroll.py --episode 14 S00=Beni S01=Guren …`
   Names to expect: Guren, Ceylan, Toxsa, Chooki, Gen, Beni, Mr. White, Vilius, Boreas, Kiiro
   (late eps), Granox, Slyger. Eps 49–52 store separate JP profiles automatically (different VAs).
2. `…python.exe pipeline\transcribe\diarize_match.py` — all episodes auto-label; any voice it
   can't match exports more clips (enrollment is incremental — new characters appear over the
   series, label them as they surface; user explicitly flagged this).
3. `…python.exe pipeline\transcribe\scene_tag.py` — adds quarton/quarton-battle/earth tags
   (user's heuristic: tenkai names ⇒ Quarton).
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

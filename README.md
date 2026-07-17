# Beni — Tenkai Knights Roleplay

A local-first, character-accurate AI roleplay app for **Beni** (Tenkai Knights, English dub canon).
Runs entirely on your PC; installable on your phone as a PWA through a Cloudflare Tunnel.

![status](https://img.shields.io/badge/phase-1%20complete-white)

## What makes her accurate

| Layer | What it carries | Where |
|---|---|---|
| Identity card + speech guide | Who she is, how she talks (30+ canon quotes) | `character/beni/` |
| **Timeline stages** | Ep 14 Beni ≠ ep 51 Beni: goals, relationships, knowledge caps | `character/beni/stages/` |
| **Canon RAG** | 300+ wiki/wikipedia/tvtropes docs, semantically retrieved, **hard-capped by episode** so she can't know her own future | SQLite `data/beni.db` |
| **Episodic memory** | Auto-distilled memories per chat, recalled in later scenes | per chat, copied on fork |
| Voice LoRA (phase 3) | Her cadence baked into the model itself | `docs/LORA-TEXT.md` |

## Quickstart

```powershell
npm install
npm run scrape     # rebuild the canon corpus from the wikis (already committed)
npm run ingest     # embed corpus into SQLite (local CPU embeddings, no API)
npm run build      # build the web app
npm start          # http://localhost:3001
```

Dev mode (hot reload): `npm run dev` → http://localhost:5173

**Connect a model** (Settings panel in the app):
- Local (default, recommended): KoboldCpp + Cydonia 24B on your GPU → `docs/MODELS.md`
- Cloud: any OpenAI-compatible API (OpenRouter etc.)
- No model yet? Set endpoint to `mock` to try the app.

**Phone**: `docs/TUNNEL.md` — named Cloudflare Tunnel + install as app. Set an access key in Settings first.

## Features

- **Two modes** per chat: *Isolated* (any scenario, pick her story stage on the timeline dial) or
  *Story* (anchored just after a specific episode, continuity enforced, knowledge capped).
- **Branching**: edit any of your messages or regenerate hers → sibling branches with a `‹ 2/3 ›` switcher.
- **Checkpoints**: name a moment, restore it anytime.
- **Fork chat**: duplicate the conversation (history + her memories) from any message to test different reactions.
- **Memory panel**: see and prune what she remembers about this chat.
- **Retrieval peek**: expand "what she recalled" to audit canon + memory retrieval.
- Minimal black/white UI, dark default, PWA with auto-update.

## Project phases

1. ✅ App + corpus + persona (this)
2. ⏳ Episode transcripts — drop episode files in `data/episodes/`, then `pipeline/transcribe/` → `docs/TRANSCRIPTION.md`
3. ⏳ Voice LoRA — `npm run export-lora` once transcripts exist → `docs/LORA-TEXT.md`
4. ⏳ Image LoRA — 87 reference images already in `data/images/beni/` → `docs/LORA-IMAGE.md`

## Commands

| Command | Does |
|---|---|
| `npm start` / `npm run dev` | serve app / dev with hot reload |
| `npm run scrape` | re-scrape fandom wiki + wikipedia + tvtropes (canon-filtered) |
| `npm run ingest` | (re)embed corpus + any transcripts into the DB |
| `npm run search -- "query" --cap 25` | test what she can recall at an episode cap |
| `npm run images` | download her wiki gallery (image-LoRA dataset) |
| `npm run icons` | regenerate PWA icons from `assets/beni-source.png` |
| `npm run export-lora` | build LoRA training JSONL from transcripts |
| `npm test` / `npm run typecheck` | core logic tests / TS check |
| `npm run tunnel:quick` | throwaway Cloudflare quick tunnel |

## Layout

```
character/beni/     her card, speech guide, 5 timeline stages (edit freely)
data/corpus/        scraped canon docs (committed)
data/episodes/      ← put episode media here (gitignored)
data/transcripts/   speaker-labeled transcripts land here → npm run ingest
data/images/beni/   image-LoRA dataset seed
pipeline/transcribe/ whisper + diarization + voice enrollment
src/server/         Express API: chat engine, RAG, memory, auth
src/web/            React PWA
docs/               MODELS · TUNNEL · TRANSCRIPTION · LORA-TEXT · LORA-IMAGE
```

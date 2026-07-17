# Beni RP — Design Spec (approved 2026-07-17)

A local-first, character-accurate AI roleplay app for **Beni** from *Tenkai Knights*
(English dub canon), running on the user's PC (RTX 5060 Ti 16GB, 32GB RAM, Win10),
reachable from their phone as an installable PWA through a named Cloudflare Tunnel.

## Goals

1. Maximum character accuracy: philosophy, goals, relationships, past, speech style,
   the city she lives in (Benham City), the people in her life — grounded in a scraped
   canon corpus, never fan-fiction.
2. Timeline awareness: Beni at ep 14 is a different person than at ep 51. The user picks
   the point in the story; she must not know future events.
3. Long-term memory per chat (RAG over auto-extracted episodic memories).
4. Save/branch/test-reactions: message tree, named checkpoints, chat forks.
5. Two modes: **Isolated** (any scenario at a chosen stage) and **Story** (anchored to an
   exact episode, continuity with show events).
6. Minimalist black/white UI, dark default, her image as logo/avatar.
7. Model-agnostic: local **Cydonia 24B** (KoboldCpp, OpenAI-compatible) as default;
   OpenRouter or any OpenAI-compatible endpoint pluggable in Settings.
8. Future-proofed slots: episode files → automated transcription + speaker ID → voice
   LoRA dataset → QLoRA training kit. Image LoRA dataset from wiki gallery.

## Decisions (user-confirmed)

- **Backend**: local default (KoboldCpp + Cydonia 24B GGUF) + optional cloud API.
- **Tunnel**: named Cloudflare tunnel on user's own domain (stable URL, access key).
- **Canon**: English dub (age 13, Nika Futterman voice; wiki quotes are dub).
- **Episodes**: user acquires them personally; project leaves `data/episodes/` slot +
  zero-touch pipeline. We do not fetch from unlicensed hosts.

## Architecture

One Node 20 + TypeScript process (Express) serving REST + SSE + the built React SPA.
SQLite (better-sqlite3) stores everything. Embeddings computed locally
(@huggingface/transformers, `Xenova/bge-small-en-v1.5`, 384-dim, CPU). No external
service is required at runtime except the chosen LLM endpoint.

```
[React PWA (Vite)] ⇄ [Express API + SSE] ⇄ [SQLite: chats/messages/memories/docs/chunks]
                              │
                    [Prompt builder] ← card + stage + speech + mode
                              │            + canon RAG (episode-capped)
                              │            + per-chat memories (episodic RAG)
                              ▼
        [OpenAI-compatible client] → KoboldCpp (Cydonia) | OpenRouter | mock
```

### Data model (SQLite)

- `docs(id, source, title, kind, episode, url, content, hash, updated_at)` — corpus docs.
  `kind ∈ character|episode|location|item|faction|concept|transcript|merch|other`.
- `chunks(id, doc_id, seq, text, episode, kind, embedding BLOB)` — retrieval units.
  `episode` = max episode referenced in the chunk's section (NULL = timeless).
- `chats(id, title, mode, stage_id, episode_cap, head_message_id, forked_from, …)`.
- `messages(id, chat_id, parent_id, role, content, created_at, meta)` — a **tree**;
  `chats.head_message_id` selects the active leaf; siblings = alternate branches.
- `checkpoints(id, chat_id, message_id, name, created_at)` — named pointers.
- `memories(id, chat_id, text, importance, src_message_id, embedding, created_at)`.
- `settings(key, value)` — provider config, gen params, access key hash, etc.

### Beni's brain — five layers

1. **Identity**: `character/beni/card.md` (who she is; appearance; backstory: father's
   failed Quarton research ruined her childhood, warehouse portal, apartment, Venetta
   core, first female Tenkai Knight) + `speech.md` (mannerisms + ~30 canon quotes as
   style exemplars; teasing, "typical boys", loner philosophy).
2. **Timeline stages** (`character/beni/stages/*.md` + `stages.json`):
   - S1 Infiltrator (ep 14–25) — Gen's partner, hunts Black Dragon Key, manipulative.
   - S2 Rogue → Vilius agent (ep 26–38) — anti-friendship peak, finds Tenkai Stone.
   - S3 Free agent (ep 39–45) — own agenda, helps neither side, enjoys chaos.
   - S4 Change of heart (ep 46–51) — Kiiro, gives up the Stone, joins Knights, Guren.
   - S5 Post-series Knight (after 51) — full ally, softer, still sharp-tongued.
   Each stage: goals, worldview, relationship states, knowledge boundary (episode cap).
3. **Canon RAG**: semantic top-k over `chunks` with hard filter `episode <= cap`
   (or NULL), `kind != merch`. No future-knowledge leaks.
4. **Episodic memory**: every ~8 messages, a utility-LLM pass extracts durable facts
   from the recent window into `memories` (embedded). Retrieved per turn (excluding
   what's already in the recent history window). Fresh per chat; copied on fork.
5. **Voice LoRA (future)**: `scripts/export-lora-dataset.ts` builds chat-format JSONL
   from transcript Beni-lines (+context) and optional synthetic bootstrap; training
   configs for QLoRA on Cydonia base (rented GPU) or 12B local. LoRA = voice;
   RAG = facts.

### Chat engine

- POST message → build prompt (system: card+stage+speech+mode+RAG+memories; history:
  path from head, budgeted) → stream tokens via SSE → persist assistant node → update
  head → async memory extraction.
- Branching: edit/regenerate creates sibling nodes (`‹2/3›` switcher = move head);
  checkpoints restore head; fork copies path+memories into a new chat.
- Story mode adds "current position: just after ep N — synopsis" and caps RAG at N.
- Mock provider (`baseUrl = "mock"`) for testing without an LLM.

### Corpus pipeline

- `scripts/scrape-fandom.ts` — full wiki via MediaWiki API (batched revisions),
  **canon filter** (skip fanon/fan-made/user/blog/review pages), kind classification
  from categories, section-level episode tagging from raw wikitext links against the
  canonical 51-episode map (from wiki transcripts index), cleaned via wtf_wikipedia →
  `data/corpus/*.md` with frontmatter.
- `scripts/scrape-wikipedia.ts` — series article + episode short summaries →
  `data/episodes.json` (powers Story mode) + corpus doc.
- `scripts/scrape-tvtropes.ts` — main + characters pages (cheerio); skip gracefully if blocked.
- `scripts/download-images.ts` — Beni gallery (~90 files) → `data/images/beni/`.
- `scripts/ingest.ts` — corpus + `data/transcripts/*.json` → docs/chunks + embeddings.

### Transcription pipeline (slot; runs when episodes exist)

`pipeline/transcribe/` (Python 3.11): faster-whisper large-v3 (GPU) → pyannote
diarization → **one-time voice enrollment** (label each main character once from
sample clips) → speaker-embedding matching auto-labels all episodes → emits
`data/transcripts/epNN.json` `{episode, lines:[{speaker, text, t0, t1}]}` →
`npm run ingest` picks them up. Subtitle files (.srt/.vtt), if provided, replace
Whisper text; audio then only drives speaker labels.

### UI (minimal black/white, dark default)

Sidebar (chats, new chat) · chat pane (streaming markdown, *actions* italic, sibling
switcher, per-message actions: copy/edit/regenerate/branch/fork/checkpoint) · panels:
Settings (provider/model/params/access), Memories (view/delete), Checkpoints,
Retrieval peek (debug: what canon was retrieved). New-chat modal: mode picker + stage
timeline slider + episode picker (story). PWA: installable, auto-updating, icons from
the provided Beni image. Login gate when ACCESS_KEY is set.

### Security

Access key (env `ACCESS_KEY` or settings) → HMAC-signed cookie; required for all API
when set. API keys never leave the machine. Tunnel exposes only the one port.

## Phases

- **P1 (this build)**: scaffold, scrapers + corpus + ingest, chat engine + RAG +
  memories, branching/checkpoints/forks, personas + stages, full UI + PWA + icons,
  tunnel + model setup docs, mock-provider verification.
- **P2**: user supplies episodes → transcription pipeline (scripts ship in P1).
- **P3**: voice LoRA kit (dataset export ships in P1; training guide + configs).
- **P4**: image LoRA guide (dataset downloader ships in P1).

## Non-goals

- No multi-user/public hosting, no piracy fetching, no NSFW framing (canon-age teen
  character; general-accuracy RP only), no scraping beyond the canon-relevant sources.

## Verification

Mock-provider end-to-end chat; RAG spot-checks (stage-1 query about "Kiiro" must
return nothing); branching/fork/checkpoint flows; PWA build; server boot; scrape+ingest
counts reported.

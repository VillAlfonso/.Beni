# Beni RP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline execution chosen — user approved autonomous build). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved Beni RP app (spec: `docs/superpowers/specs/2026-07-17-beni-rp-design.md`): local-first character-accurate RP chat with timeline-scoped canon RAG, per-chat episodic memory, message-tree branching, minimal B/W PWA, model-agnostic LLM client, plus data pipelines (wiki scrape now; transcription/LoRA slots ready).

**Architecture:** One Express+TS process (run via tsx) serving REST/SSE and the Vite-built React SPA; SQLite via better-sqlite3; local embeddings via @huggingface/transformers (bge-small-en-v1.5, q8). Scrapers are standalone tsx scripts writing markdown corpus with frontmatter; ingest embeds into SQLite. LLM = any OpenAI-compatible endpoint (KoboldCpp default, OpenRouter optional, `mock` for tests).

**Tech Stack:** Node 20.19 (ESM), TypeScript (tsx runner, no server build step), Express 4, better-sqlite3, @huggingface/transformers, wtf_wikipedia, cheerio, gray-matter, React 18, Vite 5, vite-plugin-pwa, react-markdown, sharp (dev, icons), concurrently (dev).

## Global Constraints

- Node 20.x, `"type":"module"`, all TS run through `tsx` (no tsc emit; `tsc --noEmit` for checks).
- Ports: server **3001** (dev+prod), Vite dev **5173** proxying `/api` → 3001. cloudflared targets 3001.
- SQLite file: `data/beni.db`. All IDs `crypto.randomUUID()`. Times = `Date.now()` ms integers.
- Embeddings: `Xenova/bge-small-en-v1.5`, 384-dim Float32, normalized; query prefix `"Represent this sentence for searching relevant passages: "`; passages unprefixed.
- Episode-cap invariant: retrieval NEVER returns chunks with `episode > cap`; `kind='merch'` excluded from RP retrieval; NULL episode = timeless (allowed).
- Canonical episode map: 1–51 + SP exactly as in wiki transcripts index (Lost Key=14 … Lone Wolf=51).
- English dub canon. Beni is 13; **no NSFW framing anywhere** (persona, prompts, docs).
- UI: strict monochrome tokens (`--bg:#0a0a0a` dark default), light theme via `[data-theme=light]`; only imagery (logo/avatar) carries color. No external network requests at runtime (fonts bundled).
- Mock provider: `LLM base URL = "mock"` streams deterministic text — used by all e2e verification.
- Commit at each task boundary with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Scaffold & dependencies

**Files:** Create `package.json`, `tsconfig.json`, `vite.config.ts`, `.env.example`, `src/web/index.html` (placeholder), `src/server/index.ts` (hello route only, replaced in Task 6).

**Produces:** `npm run dev|build|start|scrape|ingest|icons|images|export-lora|test|typecheck`.

- [ ] Write package.json (deps above; scripts: dev = concurrently tsx-watch + vite; start = tsx server; test = `tsx --test src/**/*.test.ts`), tsconfig (strict, NodeNext, jsx react-jsx, noEmit), vite.config (react + VitePWA autoUpdate + proxy `/api`→3001, root src/web, outDir ../../dist).
- [ ] `npm install` (background OK). Verify: exit 0, `npx tsx -e "console.log(1)"` prints 1.
- [ ] Copy provided Beni image → `assets/beni-source.png`; `.env.example` with PORT/ACCESS_KEY/LLM_* placeholders.
- [ ] Commit `chore: scaffold`.

### Task 2: DB + core logic (tree, cosine, chunker) with tests

**Files:** Create `src/server/db.ts`, `src/server/core/tree.ts`, `src/server/core/vector.ts`, `src/server/core/chunker.ts`, tests alongside as `*.test.ts`.

**Interfaces (later tasks rely on exactly these):**
- `db.ts`: `getDb(): Database` (singleton, WAL, schema init per spec tables), `newId(): string`.
- `tree.ts`: `pathToRoot(db, messageId): Msg[]` (root→leaf order), `siblingsOf(db, messageId): {ids: string[], index: number}`, `createMessage(db, {chatId, parentId, role, content, meta?}): Msg`, `forkChat(db, {chatId, uptoMessageId, title}): {newChatId}` (copies path messages with fresh ids preserving structure + memories created ≤ that point, sets head).
- `vector.ts`: `cosineTopK(query: Float32Array, rows: {id, vec: Float32Array, episode: number|null, kind: string}[], k, {episodeCap?, excludeKinds?}): {id, score}[]` (assumes normalized: dot product), `toBlob(v: Float32Array): Buffer`, `fromBlob(b: Buffer): Float32Array`.
- `chunker.ts`: `chunkSections(sections: {heading, text, episode: number|null}[], {target=1400, overlap=200}): {text, episode}[]`.

- [ ] Write failing tests: tree path/siblings/fork (in-memory sqlite), cosine cap-filter (chunk with episode 46 invisible at cap 25), chunker overlap boundaries.
- [ ] Run `npm test` → FAIL. Implement. Run → PASS.
- [ ] Commit `feat: db schema + tree/vector/chunker core`.

### Task 3: Scrapers → corpus (+ images, episode map)

**Files:** Create `scripts/lib/fandom.ts` (API client: allpages walk incl. `apcontinue`, batched revisions ≤50 titles, polite UA + 350ms delay), `scripts/lib/wikitext.ts` (wtf_wikipedia wrapper: sections→clean text, category extraction, episode-ref extraction from raw `[[Links]]` per section via episode map), `scripts/episode-map.json` (canonical 51+SP from transcripts index), `scripts/scrape-fandom.ts`, `scripts/scrape-wikipedia.ts` (article + `{{Episode list}}` ShortSummary regex → `data/episodes.json` `{no,title,synopsis}[]` + corpus doc), `scripts/scrape-tvtropes.ts` (cheerio on Characters/Main pages; graceful skip on non-200), `scripts/scrape-all.ts`, `scripts/download-images.ts` (Beni page gallery File: titles → imageinfo URLs → `data/images/beni/`).

**Canon filter (fandom):** skip namespaces ≠ 0; skip title/category matching `/fanon|fan[- ]?(made|fiction|on)|custom|oc\b|roleplay|review|encode|transcript/i`; skip `content.length < 200`; kind from categories (Characters→character, Episodes→episode, Locations→location, Items|Weapons|Vehicles→item, Factions→faction, Toys|Merchandise→merch, else concept).

**Corpus format:** `data/corpus/<source>--<slug>.md` with frontmatter `{source,title,kind,episode,url}` + body = `## section` blocks; section episode tags embedded as `<!--ep:N-->` markers consumed by ingest.

- [ ] Implement libs + scrapers. Run `npm run scrape` (background). Verify: ≥150 canon docs in data/corpus, `fandom--beni.md` contains Personality+Quotes+Relationships, fanon pages absent, `data/episodes.json` has 51 entries with synopses.
- [ ] Run `npm run images`. Verify ≥40 files in `data/images/beni/`.
- [ ] Commit `feat: canon scrapers + corpus` (corpus is gitignored? NO — corpus IS committed; raw/ and images/ are ignored. Adjust .gitignore: keep `data/corpus/` tracked, plus `data/episodes.json`, `scripts/episode-map.json`).

### Task 4: Embedder + ingest + search CLI

**Files:** Create `src/server/rag/embedder.ts`, `scripts/ingest.ts`, `scripts/search.ts` (CLI: `npx tsx scripts/search.ts "query" --cap 25`).

**Interfaces:**
- `embedder.ts`: `embedPassages(texts: string[]): Promise<Float32Array[]>`, `embedQuery(text: string): Promise<Float32Array>` (lazy singleton pipeline, batch 16, q8 dtype).
- `ingest.ts`: reads corpus md + `data/transcripts/*.json` (`{episode, lines:[{speaker,text,t0?,t1?}]}` → windows of 15 lines, kind='transcript') → upsert docs by (source,title) skipping unchanged hash → delete+reinsert chunks with embeddings.

- [ ] Implement; run `npm run ingest`. Verify: prints doc/chunk counts (expect roughly 1–3k chunks), rerun is incremental (0 re-embedded).
- [ ] Verify episode-cap: `search.ts "Kiiro four-leaf clover" --cap 25` → no Kiiro chunks; `--cap 51` → Kiiro chunks present. `search.ts "warehouse portal" --cap 20` returns Beni warehouse material.
- [ ] Commit `feat: local embeddings + ingest + search CLI`.

### Task 5: Persona (card, speech, 5 stages, stages.json)

**Files:** Create `character/beni/card.md`, `character/beni/speech.md`, `character/beni/stages/{s1-infiltrator,s2-vilius-agent,s3-free-agent,s4-change-of-heart,s5-knight}.md`, `character/beni/stages.json` (`{id,label,episodeRange:[a,b],cap,short}` ×5), `character/beni/system-rules.md` (RP rules incl. never-speak-for-user, stay-in-character, content boundaries).

- [ ] Read `data/corpus/fandom--beni.md` + gen/guren/kiiro/vilius/venetta/quarton/benham-city docs first; write files grounded ONLY in scraped canon (episode-referenced).
- [ ] Manual lint: s1/s2 files must not mention Kiiro/redemption; s1 must not mention working for Vilius as past; caps = 25/38/45/51/999.
- [ ] Commit `feat: Beni persona + timeline stages`.

### Task 6: Server API + chat engine

**Files:** Create `src/server/index.ts` (express, auth middleware, static dist serving, routes mount), `src/server/auth.ts` (HMAC cookie; bypass when no ACCESS_KEY), `src/server/settings.ts` (DB-backed with env fallback; GET masks apiKey), `src/server/llm/provider.ts`, `src/server/rag/retrieve.ts`, `src/server/prompt/builder.ts`, `src/server/memory/extractor.ts`, `src/server/routes/{chats,messages,checkpoints,memories,search,misc}.ts`.

**Interfaces:**
- `provider.ts`: `streamChat(msgs: {role,content}[], opts: {baseUrl,apiKey?,model,temperature,maxTokens,topP, signal}): AsyncGenerator<string>`; `baseUrl==="mock"` yields scripted ~60-token reply mentioning first retrieved canon title (deterministic).
- `retrieve.ts`: `retrieveCanon(q, {cap, k=6}): Chunk[]`, `retrieveMemories(chatId, q, {k=6, excludeMessageIds}): Memory[]`.
- `builder.ts`: `buildSystemPrompt({stage, mode, episodeCap, storyEpisode?, canon, memories, userName}): string` assembling card+stage+speech+system-rules+mode block+canon block+memories block; `buildHistory(path, budgetChars=24000)`.
- `extractor.ts`: `maybeExtract(chatId)` — if ≥8 msgs since last memory: utility LLM → JSON `[{text,importance}]` (defensive parse) → embed+insert; never throws.
- REST (all under `/api`): `POST /login {key}`; `GET /me`; `GET/PUT /settings`; `GET /character` (stages.json+labels); `GET /episodes`; `GET/POST /chats`; `GET /chats/:id` (chat+path+checkpoints); `PATCH /chats/:id` (title/stage/cap/mode/head); `DELETE /chats/:id`; `POST /chats/:id/fork {messageId,title?}`; `POST /chats/:id/messages {content}` → SSE `token|done|error` events; `POST /chats/:id/regenerate {messageId}` → SSE; `PATCH /messages/:id {content}` (user-edit → new sibling branch, returns new head); `GET /messages/:id/siblings`; `POST /chats/:id/checkpoints {name}`; `POST /checkpoints/:id/restore`; `DELETE /checkpoints/:id`; `GET /chats/:id/memories`; `DELETE /memories/:id`; `POST /search {q,cap}`; `GET /health`.
- SSE wire format: `event: token\ndata: {"t":"..."}\n\n`, terminal `event: done\ndata: {"messageId":"...","headId":"..."}` or `event: error\ndata:{"message"}`.

- [ ] Implement all; `npm run typecheck` clean.
- [ ] Verify with mock provider via curl: login-less (no key set) → create chat (stage s1) → POST message → SSE streams → done; GET chat shows 2-node path; regenerate → siblings 2; checkpoint+restore moves head; fork copies; `POST /search {"q":"Kiiro","cap":25}` → empty.
- [ ] Commit `feat: chat engine + API`.

### Task 7: Frontend PWA (+icons)

**Files:** Create `scripts/make-icons.ts` (sharp: face-crop square from assets/beni-source.png → public/icons/{icon-192,icon-512,maskable-512,apple-180,favicon-64}.png + public/logo.png), `src/web/{index.html,main.tsx,app.tsx,api.ts,store.tsx,styles.css}`, `src/web/components/{Sidebar,ChatView,MessageBubble,Composer,NewChatModal,SettingsPanel,MemoriesPanel,CheckpointsPanel,StagePicker,LoginGate,RetrievalPeek}.tsx`, PWA manifest via vite-plugin-pwa config.

**Behavior:** streaming via fetch+ReadableStream parsing SSE; sibling `‹ n/m ›` switcher (PATCH head); per-message actions copy/edit/regenerate/branch-fork/checkpoint; new-chat modal = mode toggle + stage slider (5 stops, episode labels) + story-episode dropdown (from /episodes); settings = provider/model/params/access-key/utility-model; drawers slide over chat on mobile (≤720px); markdown w/ italics actions; strict mono theme, dark default, light toggle persisted.

- [ ] Invoke frontend-design skill before writing UI; implement; `npm run icons`; `npm run build` → dist.
- [ ] Verify via Playwright against `npm start` + mock provider: login bypass, create chat, send message, streamed reply renders, regenerate shows ‹1/2›, fork creates chat, checkpoint restore, settings persist, screenshot desktop+mobile widths, PWA manifest present in dist, icons exist.
- [ ] Commit `feat: PWA frontend`.

### Task 8: Pipelines-slot + docs + final verify

**Files:** Create `pipeline/transcribe/{README.md,requirements.txt,transcribe.py,diarize_match.py,enroll.py,build_transcripts.py}` (faster-whisper large-v3 + pyannote 3.1 + ECAPA enrollment matching → data/transcripts/epNN.json; consumes data/episodes/*.{mkv,mp4,m4a,srt,vtt}), `scripts/export-lora-dataset.ts` (transcripts+quotes → train.jsonl chat-format with context windows; `--synthetic-seed` flag emits generation prompts for bootstrap), `docs/{MODELS.md,TUNNEL.md,TRANSCRIPTION.md,LORA-TEXT.md,LORA-IMAGE.md}`, `README.md`.

- [ ] Write pipeline scripts (import-guarded, clear CLI errors when deps/files absent — they must not break `npm test`).
- [ ] Docs: MODELS (KoboldCpp + Cydonia-24B GGUF download/settings/port 5001, OpenRouter alt, sampler suggestions), TUNNEL (named tunnel step-by-step + quick-tunnel fallback + PWA install), TRANSCRIPTION (pipeline usage + enrollment flow), LORA-TEXT (dataset stats gates, QLoRA configs axolotl+unsloth, rented-GPU walkthrough, synthetic bootstrap ethics/curation), LORA-IMAGE (dataset from data/images/beni + tagging + kohya/Illustrious settings), README (quickstart, feature tour, phase status).
- [ ] Final verify: fresh `npm install`+`npm run build`+`npm start` on clean checkout path; mock e2e; `npm test`; typecheck; report counts (docs/chunks/images).
- [ ] Commit `feat: pipelines slot + docs`; final summary to user.

## Self-Review

- Spec coverage: goals 1-8 → Tasks 3-5 (accuracy corpus/persona), 2+6 (memory, branching, modes), 7 (UI/PWA), 8 (slots/docs/tunnel). ✓
- No placeholders: interfaces are exact; code-level detail intentionally lives in implementation (inline execution by same agent, milestone granularity approved deviation). ✓
- Type consistency: names cross-checked (pathToRoot/forkChat/streamChat/retrieveCanon/buildSystemPrompt used consistently). ✓

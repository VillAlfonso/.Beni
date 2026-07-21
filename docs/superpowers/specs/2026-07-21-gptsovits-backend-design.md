# Her voice on GPT-SoVITS — design

**Date:** 2026-07-21
**Status:** approved, pre-implementation

## What changes

GPT-SoVITS becomes Beni's speaking voice, replacing RVC as the everyday backend.
The motivation is quality: RVC only swaps timbre onto a stiff SAPI/neural source,
which is an inherent robotic ceiling, not a tuning problem. GPT-SoVITS synthesizes
her prosody from a reference clip of her own, so it clears that ceiling — verified
by ear against F5-TTS and StyleTTS2 in a zero-shot bench (see
[[tts-cloning-eval]]).

Four things, in dependency order:

1. **A new backend `voice/backends/gptsovits.py`**, mirroring `qwen.py`: it clones
   one sentence through the emotion clip that matches her tone, chosen by the
   existing mood engine. It runs the **v2** model in **reference-free** mode
   (audio only, no transcript).
2. **A reference-prep build step** that turns her emotion anchors into
   GPT-SoVITS-legal 3–10s reference clips.
3. **Per-sentence mood** in the shared pipeline: today one mood is chosen per
   reply; after this, each sentence is scored on its own, so one bubble can shift
   register (angry → then teasing) and each sentence is cloned through its own
   tone's reference.
4. **RVC retired** as the launched default; `Beni.bat` starts GPT-SoVITS.

These are separable and each leaves something that works: the backend renders a
line before the per-sentence-mood refactor is touched; per-sentence mood is a
shared-pipeline change that stands on its own.

## Decisions already made

| Decision | Choice | Why |
|---|---|---|
| Backend role | **Replace RVC** as the everyday voice | User chose it; RVC's robotic ceiling is the whole reason for the switch. |
| Reference mode | **Reference-free** (audio only) | v2 supports it; sidesteps the emotion clips' garbled/fragmentary transcripts (e.g. `lecturing`), so every usable clip works immediately. |
| Model version | **v2** | Ref-free is *blocked* on v3/v4 (they need a vocoder and raise `NO_PROMPT_ERROR`). v2 is proven working in the eval. |
| Tone → clip | **Reuse the existing mood engine** | `pick_mood` → `MOOD_RULES` → `resolve_ref` already means "her tone → the matching clip, or the closest," with a fallback chain. |
| Mood granularity | **Per sentence** | User wants one bubble to be able to change register between sentences. |
| Device | **Dynamic** CUDA/CPU, like `qwen.py` | Cydonia-24B usually owns the card; GPT-SoVITS falls back to CPU. |
| RVC code | **Kept dormant**, not deleted | Same status Qwen already has; leaves a fast, reversible fallback. Deleting `rvc.py` + its `voice-runtime` weights is a later, separate call. |
| Runtime home | Promote `voice-runtime/tts-eval/gptsovits/` → `voice-runtime/gptsovits/` | A clean production home; same-volume rename, proven safe ([[verify-before-asserting-constraints]]). Delete the throwaway `tts-eval/f5` and `tts-eval/styletts2`. |

## Architecture

### One server, now three backends, one port

`voice/server.py` stays backend-agnostic. The mood rules, sentence chunking,
pacing/tempo, nonverbal leads, the rendered-line cache and the
first-sentence/remainder streaming split are all shared. Only `synth()` differs
per backend, and GPT-SoVITS is shaped exactly like Qwen — `synth(text, mood)`
resolving a reference by mood — so it drops into the existing seam.

`--backend` gains `gptsovits` and defaults to it:

| Launcher | Interpreter | Backend |
|---|---|---|
| `Beni.bat` | `voice-runtime\gptsovits\.venv\Scripts\python.exe` | `--backend gptsovits` (default) |
| `Beni-rvc.bat` *(new, optional)* | `voice-runtime\.venv\Scripts\python.exe` | `--backend rvc` (dormant fast path) |
| `Beni-voice.bat` | `addons\tts\.venv\Scripts\python.exe` | `--backend qwen` (dormant) |

The server runs **inside the GPT-SoVITS venv**. Its module-level imports are
stdlib + `anchors` (also stdlib + json), which resolve there; `numpy`/`soundfile`
stay deferred into functions and are present in that venv. The backend is
imported lazily, so the other two backends' dependencies are never touched.

### `gptsovits.py` internals

```python
NAME = "gptsovits"
SR_HINT = 32000          # v2 output rate
RUNTIME = ROOT / "voice-runtime" / "gptsovits"   # repo + venv + v2 models
```

`load()` (lazy, cached):
- Applies the four Windows/Blackwell fixes proven in the eval, folded in so the
  backend is self-contained: patch `torchaudio.load/save/info` → `soundfile`
  (torchaudio 2.11 routes through torchcodec, which needs FFmpeg shared DLLs this
  box lacks); the `jieba_fast`→`jieba` shim ships in the venv's site-packages;
  `matplotlib` is installed; UTF-8 stdout so espeak/phoneme debug prints don't
  crash the cp1252 console.
- Adds `RUNTIME/repo/GPT_SoVITS` to `sys.path`, `os.chdir(RUNTIME/repo)` (safe —
  `server.py` addresses its files by absolute path derived from `__file__`, the
  same way the RVC backend already chdir's into `voice-runtime`).
- **Dynamic device** like `qwen.py`: `free, _ = torch.cuda.mem_get_info()`; CUDA
  (`is_half=True`) when free VRAM clears a threshold (~2.5 GB), else CPU
  (`is_half=False`). CPU is a usable fallback, not a failure (measured below).
- Builds `TTS(TTS_Config({...v2 paths, device...}))`.

`synth(text, mood)`:
- `ref = resolve_gsv_ref(mood)` — the tone's trimmed reference audio (below).
- `pipe.run({... "prompt_text": "", "prompt_lang": "en", "text_lang": "en",
  "ref_audio_path": ref, "text_split_method": "cut5", "return_fragment": False})`.
  Empty `prompt_text` = ref-free. `cut5` (split on punctuation) is the **no-cutoff
  guard**: a very long input is split at punctuation and concatenated through the
  *same* reference, so nothing is truncated; a short sentence passes through whole.
- Concatenates the yielded chunks, returns `(np.float32 samples, 32000)`.

The server retries a failed `synth` once, so this doesn't.

## Reference pipeline — "use all the clips, by tone"

### Legal references (3–10s, audio only)

GPT-SoVITS **rejects** any reference outside 3–10s (`TTS.py:817`), so the raw
anchors can't all be used directly. A build step
**`voice/build/trim_gsv_refs.py`** produces one legal reference per *usable*
emotion into `voice/clips/emotions/gsv-refs/<name>.wav` (derived audio, gitignored
like the anchors themselves):

- **In range (3–10s)** → copied as-is.
- **Over-long (>10s)** — `sad` (28s), `happy_long` (30s), `happy_soft` (12s),
  `touched`/`angry_low` (11s) → trimmed to a clean ~8s window starting at the
  first sustained voiced run (reusing `trim_lead`'s energy logic) and ending at
  the nearest pause.
- **Skipped** — clips comfortably under 3s (`defensive` 1s, `shouting2` 1s) and
  cut-off word fragments (`teasing_aww`), plus the pure-laughter clips
  (`laughing`, `laugh2`, which have no speech and are already played as nonverbal
  leads, not cloned through).
- **Borderline (~3.0s)** — `flustered`, `shouting`: kept if GPT-SoVITS's range
  check accepts them, else they fall through the mood fallback chain to an
  adjacent register. The build step verifies each emitted clip loads legally
  rather than assuming.

The resulting usable set is ~16 registers spanning her range: neutral, happy,
teasing, excited, desperate, lecturing, belittling, assertive, angry, angry_low,
appreciative, touched, sad, happy_soft, happy_long, flustered2, flustered3 (plus
the borderline flustered/shouting if accepted).

### Tone → reference, reusing the mood engine

`resolve_ref(mood)` in `anchors.py` already walks
`ANCHOR_FOR → mood → MOOD_FALLBACK → DEFAULT_MOOD → neutral` and returns the first
present clip. It is generalized to accept the library to resolve against
(**backward-compatible**: `resolve_ref(mood, lib=None)` defaults to
`load_emotions()`). The GPT-SoVITS backend resolves against the **gsv-refs set**,
so a mood whose clip was skipped degrades to the nearest usable register instead
of erroring. This is the whole of "depending on the tone… or the closest to it" —
it already exists; we point it at the trimmed set.

## Per-sentence mood

Today `_speak` computes one `mood` for the reply and closes over it for reference
selection, `shape()`'s pitch/tempo, and the inter-sentence gap. The change makes
mood a property of each sentence.

### Ordered segmentation

A new `segment_reply(raw) -> list[(sentence, mood)]`:
- Walk the reply preserving the **order** of speech and stage-direction (starred /
  narration) segments, rather than aggregating them as `split_speech` does.
- Split the speech into sentences (the existing `chunk_sentences` merge rules for
  too-short fragments and the sarcastic `?`→`.` rewrite still apply).
- For each sentence, its **local descriptor** is the nearest stage-direction beat
  in reading order (the one immediately preceding it, else the reply-level
  descriptor). `mood = pick_mood(sentence, local_descriptor)`.
- An explicit `req.mood` still overrides: every sentence takes it, preserving the
  API and the manual path.

### Threading it through render

`render(parts)` takes `(sentence, mood)` pairs. Per pair: `backend.synth(sentence,
mood)`, then `shape(..., PITCH[mood], RATE[mood])`, then a gap of `PACING[mood]`.
`shape()` gains `pitch`/`rate` parameters instead of closing over reply-level
values. The first-sentence/remainder streaming split is unchanged — it slices the
pairs list at `[:1]` and `[1:]`.

### The single-mood-derived pieces

- **Nonverbal / laugh lead** is decided by the **first** sentence's mood +
  descriptor (a reply opens with a real laugh/sigh or it doesn't). Unchanged for
  single-mood replies.
- **`x-voice-mood` header** reports the first sentence's detected mood.
- **Cache key** becomes `sha1(f"{backend}|{explicit_mood or 'auto'}|{raw}")` —
  keyed on the full raw text (moods are a deterministic function of it) so two
  replies that differ only in stage direction don't collide.

Per-sentence mood is backend-independent and improves the shared pipeline for all
three backends (RVC, which ignores mood in `synth`, still gets per-sentence
pacing/tempo; nothing regresses).

## No cut-off on long replies

Two layers guarantee her longer lines aren't truncated:
1. The server already splits a reply into sentences and synthesizes each fully,
   so output length is unbounded — the 3–10s limit is on the *reference*, never on
   what she says.
2. Within a sentence, `text_split_method="cut5"` makes GPT-SoVITS split a long
   input at punctuation and concatenate through the same reference, staying under
   the model's per-generation token ceiling.

## Latency (measured, this box, LLM unloaded)

| | short sentence | full paragraph |
|---|---|---|
| GPU (card free) | 1.6s | 5.0s |
| CPU (Cydonia holds GPU) | 3.2s | 13.6s |

First-sentence streaming means perceived latency is the **first sentence** — ~1.6s
GPU / ~3.2s CPU to first audio — not the whole paragraph. Against Qwen's 14.3s to
first sentence, even the contended CPU case is a large improvement. A test gate
re-measures end-to-end through the running server, not just the model.

## Error handling

- **Missing v2 models / repo / venv** → fail loudly at `load()` naming the
  expected path, not on the first request.
- **No usable reference for a mood** → `resolve_gsv_ref` falls through to
  `neutral`; if the gsv-refs set is empty (build step never run), raise a clear
  error at first synth.
- **Reference somehow out of 3–10s** → the build step is the guard; if GPT-SoVITS
  still raises the range `OSError`, surface its message in the 500, matching how
  the other backends report `vc_single`/clone failures.
- **Device fallback** — taking CPU when VRAM is short is normal, logged, not an
  error.
- **Voice server down / synth raises** — unchanged: `/api/tts` 503 stays silent
  under auto-speak; a raised `synth` returns 500 and the client treats it as
  unavailable.

## Testing

Manual and by ear, matching how the voice work is verified throughout.

0. **Relocation gate.** After promoting the runtime to `voice-runtime/gptsovits/`,
   convert one line from the new location and listen. Proves the venv + relative
   paths survived the move before any server work.
1. **Single line end-to-end.** Start `Beni.bat`, send a message, confirm she
   speaks in her cloned voice, not robotic.
2. **Per-sentence mood switch.** A reply written to swing register mid-bubble
   (e.g. an angry sentence then a teasing one) audibly changes delivery *and* uses
   two different references — confirm via the server log naming the per-sentence
   moods.
3. **Long-reply no cut-off.** A multi-sentence monologue plays to the end; no
   sentence is dropped or truncated.
4. **Reference build.** `trim_gsv_refs.py` produces every expected 3–10s clip;
   spot-check the trimmed long ones (`sad`, `happy_long`) are clean windows.
5. **Cache + streaming.** Same line twice replays instantly; a multi-sentence
   reply returns the first sentence immediately and the remainder via `/rest`.
6. **Latency, measured through the server**, GPU and CPU.
7. **Backend isolation.** The dormant RVC/Qwen launchers still start their own
   backends; `gptsovits` deps never leak into them.

## Out of scope

- Fine-tuning GPT-SoVITS on her dataset (the real fidelity upgrade; a later
  project once zero-shot ref-free is judged by ear).
- v2Pro / v3 / v4, and text-matched (non-ref-free) cloning with cleaned
  transcripts — both possible later upgrades, both explicitly deferred.
- Deleting `rvc.py`, the RVC `voice-runtime` weights/index, or Qwen. This change
  makes RVC dormant; removing it is a separate call.
- Auto-speak, settings, and the app UI — already shipped; untouched here.

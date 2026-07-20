# Her voice, on RVC — design

**Date:** 2026-07-21
**Status:** implemented — see "What building it turned up" at the end

## What changes

Three things, in dependency order:

1. **The voice system moves out of `addons/` and becomes tracked.** `addons/` is
   gitignored wholesale, leaving it a disposable graveyard for the Piper and Qwen
   experiments — you intend to delete it outright once RVC proves itself. The
   1.7 GB of third-party model payload relocates to a gitignored `voice-runtime/`,
   and her rendered audio moves to `data/voice/` beside her chat history.
2. The voice server gains a second synthesis backend — **RVC**, converting Windows'
   SAPI Zira through the model trained on her episodes — and RVC becomes the
   everyday default. Qwen3-TTS stays working, but dormant.
3. Her replies **speak themselves**. Today the 🔊 button on a message is the only
   way to hear her; after this, a finished reply plays on its own.

The motivation for (2) is latency. Qwen3-TTS measured 14.3s to first sentence,
caused by a 1.7B autoregressive model generating tokens sequentially while
Cydonia-24B held the GPU. RVC is three feed-forward passes over a few seconds of
audio, so it should be dramatically quicker even on CPU — the point of the switch.

The motivation for (1) is that `git add -A` currently stages two Python venvs and
roughly a gigabyte of checkpoints. `.gitignore` covers `addons/tts/.venv/` but
nothing matching `addons/rvc/.venv/`, `addons/piper/`, or `addons/rvc/assets/`.

**These are three phases, gated, not one push.** The move lands and RVC is proven
to still convert audio from its new home before a line of backend code is written;
the RVC backend is working and audible before auto-speak is wired. Each gate is a
place to stop with something that works.

## Decisions already made

| Decision | Choice | Why |
|---|---|---|
| Source voice | Windows SAPI **Microsoft Zira Desktop** | Instant, local, zero install, no VRAM. Proven in `test_epoch.py`. Female, so the transpose to her ~293 Hz is small — David sits at ~90 Hz, a 20-semitone gap that wrecks conversion. |
| RVC weights | `beni_e200_s13200.pth` | Final epoch, named explicitly rather than globbed. |
| Retrieval index | `beni_added_IVF1503_Flat_nprobe_1_beni_v2.index` | 1503 clusters, `index_rate 0.5`. |
| Default backend | `rvc` | `Beni.bat` is the everyday launcher. |
| Auto-speak default | on | As requested; a setting can turn it off. |
| Runtime payload | relocated to `voice-runtime/` | Makes `addons/` fully deletable. Same-volume rename, so it costs nothing. |

Piper was evaluated as the source and set aside. The 12-voice sweep did produce a
front-runner — `prosody_ab.py` records `en_US-amy-medium` as "closest of the
candidates by ear" — so this is a choice between two working options, not a
rejection of a failed one. Zira wins on cost: no ONNX load, no voice files, and
it is already the source every RVC checkpoint was auditioned through.

## Layout

```
voice/                        TRACKED — small, hand-written, ours
  server.py                   HTTP + mood engine, backend-agnostic
  backends/rvc.py             SAPI Zira -> RVC conversion
  backends/qwen.py            dormant, unchanged behavior
  clips/beni-emotions.json    anchor manifests
  clips/beni-nonverbal.json
  clips/beni-refs.json
  clips/*.wav                 anchors + nonverbal leads (small, already tracked)
  clips/nonverbal/*.wav
  build/                      only what produces tracked anchors:
                              build_emotions*.py, trim_anchors.py

data/                         runtime state — NOT ignored wholesale
  beni.db                     chat history
  voice/cache/                needs a NEW .gitignore entry
  voice/spoken/               needs a NEW .gitignore entry

voice-runtime/                GITIGNORED — ~1.7 GB third-party
  rvc/                        the RVC library fork (59 .py files)
  .venv/                      REBUILT, not moved
  assets/hubert_base.pt       189 MB
  assets/rmvpe.pt             181 MB
  assets/indices/*.index      185 MB
  assets/weights/*.pth        ~1 GB across 18 checkpoints
  assets/pretrained_v2/

addons/                       GITIGNORED — dead ends, deletable
  piper/                      abandoned fine-tune
  tts/                        Qwen models + its venv
```

Only 24 files under `addons/` are tracked today, all in `addons/tts/` and all
small. They move with `git mv` so history follows them.

Not everything tracked comes along. The anchor *builders* move, because they
regenerate files that stay in git. The Qwen-era demos and probes —
`demo_emotions.py`, `demo_full_library.py`, `test_clone.py`, `out/clone-test-*.wav`
— stay behind and become untracked with the rest of `addons/`; they exercise an
engine being retired, and keeping them would defeat the point of the move.

`addons/tts/server.py` has uncommitted edits in the working tree. `git mv` carries
them across intact, but the move should happen before any further editing so the
diff stays legible as a rename rather than a delete-plus-add.

**Her recordings live with her chat history.** `cache/` and `spoken/` move out of
the addon to `data/voice/`, alongside `beni.db`. They are runtime state, not code,
and `spoken/` in particular is hers — the lines you actually sat through, named by
her words. It belongs next to the conversation it came from. This also leaves
`voice/` containing nothing generated, which keeps it clean in git.

Paths appear in prose as well as code, and stale documentation is its own kind of
bug in a codebase that explains itself as carefully as this one does. Known
references that go wrong on the move: the `voice.ts` header comment, which tells
you `addons/tts/spoken/` fills up with the lines you sat through; the
`addons/tts/spoken/` entry in `.gitignore`; and the stack descriptions in both
`.bat` headers. `addons/tts/README.md` moves with the code it documents.

**Qwen keeps its home.** `addons/tts/.venv` and `addons/tts/models/1.7B-Base` stay
where they are, gitignored. `voice/backends/qwen.py` reaches into them by path.
Both backends read anchors from the tracked `voice/clips/`, which is cleaner than
today, where the manifests live inside the Qwen addon.

### `addons/` must become safe to delete

You intend to delete it once RVC proves itself, so that is a hard requirement, not
an aspiration: **after this change, nothing on the RVC path may resolve into
`addons/`.** The RVC voice system reads only from `voice/` (code and anchors),
`voice-runtime/` (library, venv, weights), `data/voice/` (cache and archive), and
`C:/ffmpeg/ffmpeg`, which was never in the repo.

Deleting `addons/` therefore breaks exactly one thing — the Qwen backend, and
`Beni-voice.bat` with it. That is the intended trade, and it is verified by test 7
rather than assumed.

### `.gitignore` changes

`data/` is ignored entry by entry, not wholesale, so the new directories need
entries or her audio gets staged — the exact failure this restructure exists to
fix. Add `addons/`, `voice-runtime/`, `data/voice/`. Remove the now-dead
`addons/tts/.venv/`, `addons/tts/models/`, `addons/tts/cache/`,
`addons/tts/spoken/` and their siblings, which `addons/` now covers.

Leave the bare `logs/` pattern alone. It matches at any depth, which is the only
reason `addons/rvc/logs/beni/G_*.pth` — the full training checkpoints — were never
staged in the first place.

### The venv moves — it does not need rebuilding

An earlier draft of this spec claimed a venv can't be relocated. That is wrong,
and it was tested rather than argued: `addons/rvc/.venv` was renamed and the RVC
stack imported from the new path with `sys.prefix` following correctly, torch
2.7.1+cu128 loaded, `torch.cuda.is_available()` still `True`, and faiss, librosa
and soundfile all importing.

The reason it works: `Scripts\python.exe` locates its environment by finding
`pyvenv.cfg` *beside itself*, which is a relative lookup. `pyvenv.cfg` in turn
points `home` and `executable` at the base interpreter, not at the venv. The one
self-referential line, `command =`, is a record of how the venv was created and
is never read. Neither `.pth` file in `site-packages` contains a path — both hold
import statements — and there are no editable installs.

What genuinely breaks is `pip.exe`, `activate.bat`, and console-script shims like
`piper.exe`, all of which embed an absolute path in the launcher stub. None are on
any path we use: the launchers invoke `python.exe` directly, and `python -m pip`
resolves through `site-packages` and keeps working.

Because the move is a same-volume rename, it is effectively instantaneous and
trivially reversible — move it back if anything surprises you.

**Gate: convert one line end-to-end from the new location and listen to it before
any voice-server work begins.** The import test proves the environment survived;
it does not prove RVC's own relative-path handling did, and this library resolves
`assets/…` against the working directory and reads `weight_root` from the
environment, defaulting to the literal string `"None/"` when unset.

## Architecture

### One server, two backends, one port

`voice/server.py` is already about 80% backend-independent. The mood rules,
sentence chunking, pacing and tempo tables, sarcastic-question rewriting,
nonverbal lead clips, the rendered-line cache and the first-sentence/remainder
streaming split are all indifferent to what actually synthesizes. Only
`load_model()` and `synth_raw()` are Qwen-specific.

So the change is a seam, not a rewrite:

```python
class Backend(Protocol):
    name: str
    def synth(self, text: str, mood: str) -> tuple[np.ndarray, int]:
        """One sentence of speech. Returns samples and sample rate."""
```

`mood` is in the signature for Qwen, which uses it to select a reference clip.
The RVC backend accepts and ignores it: mood still shapes her delivery, but it
does so in the shared pipeline around `synth()`, not inside it.

The server selects with `--backend rvc|qwen`, defaulting to `rvc`. Both bind
`:5002`, so the app's `ttsUrl` setting never changes.

### The launcher picks the interpreter

RVC's dependencies and Qwen's cannot coexist in one venv, so the launcher chooses
which Python runs the server:

| Launcher | Interpreter | Backend |
|---|---|---|
| `Beni.bat` | `voice-runtime\.venv\Scripts\python.exe` | `--backend rvc` |
| `Beni-voice.bat` | `addons\tts\.venv\Scripts\python.exe` | `--backend qwen` |

Only one runs at a time, because you run one launcher or the other. That is why
sharing a port is safe.

The rejected alternative was two servers on two ports with the app probing for
whichever answers. It requires app changes and fails confusingly when both are
up — you get whichever won the probe, silently.

**Constraint this imposes:** `voice/server.py`'s module-level imports must resolve
in *both* venvs. It currently imports only stdlib at module level and defers
`numpy`/`soundfile` into functions, which already satisfies this. Backend modules
must be imported lazily, only the selected one.

### RVC backend internals

Per sentence:

1. **Speak it as Zira.** PowerShell, `System.Speech.Synthesis.SpeechSynthesizer`,
   `SelectVoice('Microsoft Zira Desktop')`, `Rate = 0`, to a temp wav.
2. **Transpose.** Semitones from Zira's measured median pitch to `TARGET_HZ = 293.0`.
3. **Convert.** `vc.vc_single(0, src, up_key, "rmvpe", index, 0.5, 0, 3, 0.33)`.
4. Hand samples and sample rate back to the shared pipeline, which applies pacing,
   tempo and any nonverbal lead exactly as it does for Qwen.

**Measure the transpose once, not per line.** `test_epoch.py` runs `librosa.pyin`
on every source file, which is right for a one-shot script and wasteful in a
server. Zira's pitch is a constant of the voice, so it is computed on first use
and cached to `data/voice/cache/zira-pitch.json`, keyed by voice name.

**Device selection is dynamic.** RVC's whole stack is roughly 1–1.5 GB resident —
ContentVec ~380 MB, RMVPE ~90 MB, the generator 55 MB, plus activations. That
would fit except Cydonia-24B holds ~9 GB and the desktop another ~6.5 GB of 16 GB.
Rather than pick statically, mirror the check `server.py` already uses for Qwen —
take CUDA when free VRAM exceeds a 2 GB threshold, fall back to CPU otherwise.
Unlike Qwen, RVC on CPU is expected to remain usable, so the fallback is not a
failure state.

**RVC needs its own working directory.** The library resolves `assets/...` on
relative paths and reads `weight_root` / `index_root` / `rmvpe_root` from the
environment, defaulting to the literal string `"None/"` when unset. The backend
sets those and `os.chdir`s into `voice-runtime/rvc/` exactly as `my_voice.py`
does. This is safe because `server.py` addresses its own files through absolute
paths derived from `__file__`, but it is global state and the backend owns it.

### Mood, under RVC

Mood keeps most of its job and loses one part of it.

Still live: `PACING` (gap between sentences), `RATE` (tempo), `SARCASTIC`
(trailing `?` becomes `.`), and the nonverbal/laugh lead clips.

No longer meaningful: `resolve_ref()` and the `MOOD_FALLBACK` / `ANCHOR_FOR`
chains, which exist to pick a *reference clip* for voice cloning. Under RVC the
timbre comes from the trained model, so a reference has nothing to do. That
machinery stays in the Qwen backend and is not called by the RVC one.

SAPI offers only a coarse integer `Rate` (−10..10) and no equivalent of Piper's
`noise_w_scale`, so per-mood delivery stays where it already is: tempo applied
after conversion via the existing ffmpeg pass, reusing the `RATE` table as tuned
rather than re-tuning against a coarse integer.

## Defects in the current code that this must fix

Pre-existing, and each would produce broken audio under RVC. This is the substance
of the work; the backend seam is comparatively mechanical.

1. **Apostrophes break the PowerShell call.** `test_epoch.py` documents this
   directly — its test line is written without apostrophes because a stray `'`
   terminates the single-quoted literal and the command fails to parse. Her real
   replies are full of `don't`, `you're`, `I'm`, plus curly quotes and em-dashes.
   Interpolating reply text into a command string is both a parse bug and a
   command-injection surface.
   **Fix:** write the sentence to a UTF-8 temp file; PowerShell reads it with
   `[IO.File]::ReadAllText(path, [Text.Encoding]::UTF8)`. Only a path we generate
   ever reaches the command line. This also fixes non-ASCII punctuation.

2. **`shape()` hardcodes 24000 Hz**, which is Qwen's rate — see the
   `asetrate=24000*…` and `sf2.write(src, …, 24000)` calls. RVC outputs 40000 Hz.
   Left alone, every line is pitched up by 40/24, a major sixth.
   **Fix:** thread the real sample rate through as a parameter.

3. **`real_sound()` never resamples.** It reads her laugh/sigh clip at the clip's
   own rate `lsr` and the caller concatenates it onto speech at `sr0` without
   reconciling them. Harmless while both are 24000; at 40000 the lead plays fast
   and sharp.
   **Fix:** resample the lead clip to the output rate before concatenating.

4. **The cache key omits the backend.** It is `sha1(f"{mood}|{spoken}")`, so the
   same line rendered by both engines collides in `cache/` and you get whichever
   was written first.
   **Fix:** include the backend name in the key.

## Auto-speak

### Trigger

`store.tsx` has a clean completion point: the `onDone` callback dispatches
`stream-end` at line 203, and the final assistant text is available as
`getState().streaming.text` immediately before that dispatch. Auto-speak fires
there and only there — not on `onError`, and not on the abort path below it, so
an interrupted or failed generation stays silent.

### The autoplay problem

Browsers only permit audio after a user gesture. This is precisely why the current
code opens its `AudioContext` synchronously inside the 🔊 click, with a comment
noting permission is revoked a few seconds later while her first sentence is still
rendering. Auto-play has no click to hang from.

**Fix:** unlock a single long-lived `AudioContext` on the user's *send* gesture,
which `send()` already runs inside, and reuse it for the reply. She only ever
speaks in response to something you sent, so a fresh gesture always precedes
playback. `voice.ts` moves from one context per utterance to one per session,
closed only on page teardown.

### Speaking state

Today "is this message speaking" is a `useState` inside each `Message` component,
passed to `speak()` as a `setSpeaking` callback. Auto-play originates outside any
component and has no such callback to reach, so the 🔊 button would show stale
state while she talks.

**Fix:** move it into the store as `speakingId: string | null`. `Message` derives
its button state from that rather than owning it. This also makes "only one voice
at a time" a property of the state rather than a convention.

### Setting

`ttsAuto`, boolean, default on. Stored alongside `ttsUrl` in the existing settings
table and added to the `WRITABLE` set in `src/server/settings.ts`, so it is
toggleable from the settings panel and persists.

## Error handling

- **Voice server down.** Unchanged — `/api/tts` already returns 503 and `voice.ts`
  already swallows it. Under auto-speak the failure must stay silent: a reply that
  can't be spoken still displays normally, with no error surfaced.
- **PowerShell/SAPI fails.** Raise from the backend; the server's existing
  `_speak` try/except returns 500 and the client treats it as unavailable.
- **RVC returns no audio.** `vc_single` signals this by returning `opt is None`
  with a reason in `info`; surface that reason in the 500 rather than a bare
  failure, matching how `my_voice.py` and `test_epoch.py` already report it.
- **Missing weights or index.** Fail loudly at startup naming the expected path,
  not on the first request. A wrong `weight_root` silently resolves to the literal
  string `"None/"`, exactly the class of bug worth failing fast on.
- **Interrupted playback.** Unchanged: an unfinished clip is discarded and never
  filed to `spoken/`. Auto-play follows the same rule, so `spoken/` keeps meaning
  "lines you actually sat through".

## Testing

Manual and by ear, matching how the voice work has been verified throughout —
there is no automated audio assertion worth writing here.

0. **Relocation gate.** Convert one line from `voice-runtime/` and listen. The venv
   itself is already proven to survive the move; what this checks is RVC's own
   relative-path handling against the new working directory. Nothing else starts
   until it passes.
1. **Apostrophe regression.** Render `"Don't — you're not listening, are you?"`.
   This is the case the current code cannot express at all, so it is the fastest
   proof the source path is right.
2. **Sample-rate regression.** Render a line with a laugh or sigh lead; confirm the
   lead is neither fast nor sharp and the speech is not pitched up a sixth.
   Defects 2 and 3 both surface here audibly.
3. **Backend isolation.** Same line through both launchers; confirm two distinct
   cache entries and two distinct-sounding results.
4. **Auto-speak.** Send a message, confirm the reply speaks unprompted, confirm the
   🔊 button reflects it, confirm clicking it stops her, confirm the setting turns
   it off.
5. **Latency, measured not assumed.** Time first-audio on CPU and on GPU. This is
   the number that justifies the whole change and it is currently unknown.
6. **Git hygiene.** `git status --porcelain` after the move shows no venv, no
   `.pth`, no `.index`, and no `.wav` outside `voice/clips/`.
7. **`addons/` deletion drill.** Rename `addons/` aside, then run `Beni.bat` and
   speak a line with a laugh lead. It must work untouched. Rename it back
   afterwards — this proves the RVC path has no hidden dependency before you
   delete anything for real, which is the difference between a safe cleanup and
   losing her voice to a missing file.

## Out of scope

- Retraining or re-culling the dataset.
- Piper — the fork stays in `addons/`, unused.
- Deleting Qwen3-TTS, its venv, or its models. This change makes `addons/`
  *deletable* and proves it with test 7; actually deleting it is your call, later,
  once RVC has earned it.
- Per-mood SAPI prosody via SSML. Possible later; the coarse `Rate` integer is not
  obviously better than the tempo table already tuned.

## What building it turned up

### A fifth defect, and the worst one: `rms_mix_rate=3`

This fork's `vc_single` takes nine arguments:

```
vc_single(sid, path, f0_up_key, f0_method, file_index,
          index_rate, resample_sr, rms_mix_rate, protect)
```

Upstream RVC's version also has `f0_file`, `file_index2` and `filter_radius`.
Every standalone script here — `my_voice.py`, `source_girls.py`, `test_epoch.py`,
`prosody_ab.py`, `source_ab.py`, `qwen_hybrid.py` — was written against the
upstream signature, so their arguments land shifted and `3` arrives as
`rms_mix_rate`, which is a 0..1 blend. At 3 the envelope computes
`rms1^-2 * rms2^2` and the output collapses: 4% of frames carrying energy against
a source's 52%, peaks pinned at the int16 ceiling, and zero detectable pitch
anywhere in it at either 40 kHz or 16 kHz.

Measured across the full matrix — three weight files, fp16 and fp32, index on and
off — all twelve combinations were identically broken, which is what pointed
upstream of the model to the call itself. With the arguments corrected, every
value in 0..1 produces real speech at 297-301 Hz against her 293 Hz target.

`webui.py` passes them correctly, so the Gradio UI was never affected. **This
means the renders in `out/epochs/`, `out/girls/`, `out/prosody/` and `out/mine/`
were all produced through the broken path.** Any conclusion drawn from listening
to those — which epoch won, which source voice sounded closest, whether the TTS
sources sound robotic — was drawn on corrupted audio and is worth revisiting.
All six scripts are fixed.

### Latency, measured

The open question is closed. On the GPU, warm:

| | |
|---|---|
| SAPI Zira | ~0.6s |
| RVC conversion, warm | **0.40s for 5.02s of audio (RTF 0.08x)** |
| First call | 5.4s — rmvpe (181 MB), the index (185 MB) and CUDA warmup, all lazy |
| Full render through the server, warm | **0.80-0.90s** |
| Cache replay | 0.009s |

Against Qwen's 14.3s to first sentence. The dynamic device threshold stayed in;
it took CUDA on every run because RVC's ~1.5 GB fits alongside Cydonia.

### The deletion drill, in full — `addons/` is safe to delete

It initially could not run: `addons/rvc/out` held an open file handle, which
turned out to be an Explorer window sitting in `addons/rvc/out/source-ab` from
auditioning the sweep. Closing it freed the directory, `out/` moved to
`voice-runtime/out/`, and `addons/rvc` is gone entirely.

With `addons/` then renamed away completely, the voice server started and
rendered both a laugh-led line (58% active, 278 voiced, 324 Hz) and a
sigh-led one with curly apostrophes (47% active, 258 voiced, 274 Hz, 0.85s warm).
`addons/` was restored afterwards.

Nothing on the RVC path names `addons` — verified across `voice/*.py`,
`voice/backends/*.py`, the manifests and `Beni.bat`. The only references left are
`backends/qwen.py` and `Beni-voice.bat`, both of which are the dormant backend
and both of which are meant to.

**You can delete `addons/` whenever you want. It costs you Qwen3-TTS and
Beni-voice.bat, and nothing else.**

### Verification of defect 3

The lead clips are 24 kHz against 40 kHz output, so the resampling fix is
load-bearing rather than incidental — an unresampled 2.00s sigh would play in
1.20s, about seven semitones sharp. The spliced lead correlates +0.945 (sigh) and
+0.987 (laugh) against the correctly-resampled clip, and +0.010 / +0.011 against
the unresampled hypothesis.

# GPT-SoVITS Voice Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make GPT-SoVITS v2 (reference-free) Beni's speaking voice, cloning each sentence through the emotion clip matching her tone, with mood scored per sentence so one reply can change register.

**Architecture:** A new `voice/backends/gptsovits.py` drops into the existing backend seam next to `rvc.py`/`qwen.py` — `synth(text, mood)` resolves a reference clip by mood (like Qwen) and clones through GPT-SoVITS v2 in ref-free mode. The shared `voice/server.py` pipeline gains per-sentence mood (`segment_reply`) and threads a per-sentence mood through synth + pitch/tempo + gap. A build step trims her emotion anchors to GPT-SoVITS-legal 3–10s references.

**Tech Stack:** Python 3.11, GPT-SoVITS v2 (`TTS_infer_pack`), torch 2.11+cu128, soundfile, numpy, ffmpeg (static CLI at `C:/ffmpeg/ffmpeg`). Voice server is stdlib-only HTTP.

## Global Constraints

- **Reference-free only** — `prompt_text=""`; never pass a transcript. Ref-free is blocked on v3/v4, so **v2 only**.
- **Reference audio must be 3–10s** — GPT-SoVITS raises `OSError` otherwise (`TTS.py:817`).
- **GPT-SoVITS output is int16 at 32000 Hz** — normalize to float32 (`/32768.0`) in the backend; `SR_HINT = 32000`.
- **Windows/Blackwell fixes required in the backend venv:** torchaudio 2.11 routes I/O through torchcodec (no FFmpeg shared DLLs here) → patch `torchaudio.load/save/info`→soundfile before importing GPT-SoVITS; `jieba_fast`→`jieba` shim (already in the venv's site-packages); `matplotlib` installed; UTF-8 stdout.
- **The backend `os.chdir`s into the GPT-SoVITS repo** — safe because `server.py` uses absolute paths from `__file__`. One synthesis at a time (`_backend_lock`) — already enforced.
- **Runtime lives at** `voice-runtime/gptsovits/` (gitignored). **Generated `gsv-refs/*.wav` are gitignored** (derived audio); the build script is tracked.
- **All pytest tests run in the promoted GPT-SoVITS venv** (`voice-runtime/gptsovits/.venv`, has numpy/soundfile; add pytest). Audio quality is judged **by ear** via explicit manual gates — the project has no automated audio assertions.
- Commit-message trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

| Path | Responsibility | Change |
|---|---|---|
| `voice-runtime/gptsovits/` | GPT-SoVITS repo + venv + v2 models (production home) | move from `tts-eval/gptsovits/` |
| `voice/build/trim_gsv_refs.py` | Turn emotion anchors into legal 3–10s audio-only references | create |
| `voice/anchors.py` | `resolve_ref(mood, lib=None)` generalization + `load_gsv_refs()` | modify (84–93) |
| `voice/backends/gptsovits.py` | v2 ref-free clone-by-mood backend | create |
| `voice/server.py` | `segment_reply` (per-sentence mood); `shape`/`render`/`_speak`/argparse/cache | modify |
| `voice/tests/` | pytest for the pure-logic pieces | create |
| `Beni.bat` | launch voice with `--backend gptsovits` | modify (24) |
| `Beni-rvc.bat` | dormant RVC launcher | create |

---

## Task 1: Promote the runtime home and prove it still works

**Files:**
- Move: `voice-runtime/tts-eval/gptsovits/` → `voice-runtime/gptsovits/`
- Delete: `voice-runtime/tts-eval/f5/`, `voice-runtime/tts-eval/styletts2/`
- (all gitignored — filesystem only, no git changes)

**Interfaces:**
- Produces: a working GPT-SoVITS venv at `voice-runtime/gptsovits/.venv` and repo at `voice-runtime/gptsovits/repo`, with `pytest` installed.

- [ ] **Step 1: Move the runtime and delete the throwaway evals**

```bash
cd /c/.Beni/voice-runtime
mv tts-eval/gptsovits gptsovits
rm -rf tts-eval/f5 tts-eval/styletts2
rmdir tts-eval 2>/dev/null || true   # leaves tts-eval only if other files remain
ls gptsovits
```
Expected: lists `repo .venv download_models.py bench_gptsovits.py ...`

- [ ] **Step 2: Install pytest into the promoted venv**

```bash
/c/.Beni/voice-runtime/gptsovits/.venv/Scripts/python.exe -m pip install --quiet pytest
```

- [ ] **Step 3: Relocation gate — convert one line from the new home and confirm audio**

Run:
```bash
cd /c/.Beni/voice-runtime/gptsovits
PYTHONIOENCODING=utf-8 ./.venv/Scripts/python.exe bench_gptsovits.py > reloc.out 2>&1
grep -E "^\[load\]|^short|^paragraph" reloc.out
ls -la out/short.wav out/paragraph.wav
```
Expected: `[load]` line prints, `short`/`paragraph` rows show non-zero `gen_s`, both wavs exist and are >0 bytes. If it fails, the venv/paths didn't survive the move — investigate before continuing.

- [ ] **Step 4: No commit** (runtime is gitignored). Note the move is done.

---

## Task 2: Reference-prep build step (`trim_gsv_refs.py`)

**Files:**
- Create: `voice/build/trim_gsv_refs.py`
- Create: `voice/tests/conftest.py`
- Create: `voice/tests/test_trim_gsv_refs.py`
- Output (gitignored): `voice/clips/emotions/gsv-refs/<name>.wav`

**Interfaces:**
- Produces: `voiced_window(y, sr, lo=3.2, hi=9.5) -> np.ndarray | None` — returns a 3–10s window starting at the first sustained voiced run, or `None` if the clip can't yield ≥`lo`s. Used only by this script; tested directly.
- Produces: `voice/clips/emotions/gsv-refs/*.wav` consumed by Task 3's `load_gsv_refs`.

- [ ] **Step 1: conftest so tests can import `voice/` modules**

Create `voice/tests/conftest.py`:
```python
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # voice/
```

- [ ] **Step 2: Write the failing test for `voiced_window`**

Create `voice/tests/test_trim_gsv_refs.py`:
```python
import numpy as np

from build.trim_gsv_refs import voiced_window

SR = 24000


def _tone(seconds, freq=200.0, sr=SR):
    t = np.arange(int(seconds * sr)) / sr
    return (0.2 * np.sin(2 * np.pi * freq * t)).astype("float32")


def test_long_clip_trimmed_into_range():
    y = _tone(20.0)
    out = voiced_window(y, SR)
    assert out is not None
    dur = len(out) / SR
    assert 3.2 <= dur <= 10.0


def test_in_range_clip_passes_through():
    y = _tone(6.0)
    out = voiced_window(y, SR)
    assert out is not None
    assert abs(len(out) / SR - 6.0) < 0.5


def test_too_short_clip_rejected():
    y = _tone(1.0)
    assert voiced_window(y, SR) is None


def test_leading_silence_trimmed():
    y = np.concatenate([np.zeros(int(SR * 1.5), "float32"), _tone(6.0)])
    out = voiced_window(y, SR)
    assert out is not None
    # first sample should be voiced, not the 1.5s of silence
    assert float(np.abs(out[: int(SR * 0.1)]).mean()) > 1e-3
```

- [ ] **Step 3: Run it, verify it fails**

Run: `cd /c/.Beni/voice && ../voice-runtime/gptsovits/.venv/Scripts/python.exe -m pytest tests/test_trim_gsv_refs.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'build.trim_gsv_refs'`

- [ ] **Step 4: Implement `trim_gsv_refs.py`**

Create `voice/build/trim_gsv_refs.py`:
```python
"""Turn her emotion anchors into GPT-SoVITS-legal 3-10s references.

GPT-SoVITS rejects any reference outside 3-10s. In ref-free mode only the audio
matters, so this cuts a clean voiced window from each usable anchor and drops
the ones that can't be references (fragments, pure laughter).

Output: voice/clips/emotions/gsv-refs/<name>.wav  (24k mono, gitignored)
Run: ..\\voice-runtime\\gptsovits\\.venv\\Scripts\\python.exe build\\trim_gsv_refs.py
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import soundfile as sf

HERE = Path(__file__).resolve().parent.parent          # voice/
EMO = HERE / "clips" / "emotions"
OUT = EMO / "gsv-refs"

# No speech in them — played as nonverbal leads, never cloned through.
SKIP = {"laughing", "laugh2", "teasing_aww", "defensive", "shouting2"}


def voiced_window(y, sr: int, lo: float = 3.2, hi: float = 9.5):
    """A 3-10s window from the first sustained voiced run, or None if too short."""
    y = np.asarray(y, dtype="float32")
    if y.ndim > 1:
        y = y.mean(axis=1)
    hop = int(sr * 0.02)
    if len(y) < int(sr * lo):
        return None
    frames = np.array([np.sqrt(np.mean(y[i:i + hop] ** 2))
                       for i in range(0, len(y) - hop, hop)])
    if not len(frames) or frames.max() <= 0:
        return None
    voiced = frames > frames.max() * 0.10
    start = 0
    run = 0
    for i, v in enumerate(voiced):          # first run of >=0.12s of voice
        run = run + 1 if v else 0
        if run * 0.02 >= 0.12:
            start = max(0, (i - run + 1)) * hop
            break
    end = min(len(y), start + int(sr * hi))
    win = y[start:end]
    if len(win) < int(sr * lo):
        win = y[start:start + int(sr * lo)]  # borrow trailing audio to reach lo
    return win if len(win) >= int(sr * lo) else None


def main() -> None:
    man = json.loads((EMO.parent.parent / "clips" / "beni-emotions.json").read_text("utf-8")) \
        if False else json.loads((HERE / "clips" / "beni-emotions.json").read_text("utf-8"))
    OUT.mkdir(parents=True, exist_ok=True)
    kept, dropped = [], []
    for name, ref in man.items():
        if name in SKIP:
            dropped.append((name, "skip-list"))
            continue
        src = HERE / ref["audio"]
        if not src.exists():
            dropped.append((name, "missing audio"))
            continue
        y, sr = sf.read(src)
        win = voiced_window(y, sr)
        if win is None:
            dropped.append((name, "too short"))
            continue
        sf.write(OUT / f"{name}.wav", win, sr)
        kept.append((name, round(len(win) / sr, 2)))

    print("kept:", ", ".join(f"{n}({d}s)" for n, d in kept))
    print("dropped:", ", ".join(f"{n}({why})" for n, why in dropped))
    print(f"-> {OUT}  ({len(kept)} references)")


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: Run tests, verify pass**

Run: `cd /c/.Beni/voice && ../voice-runtime/gptsovits/.venv/Scripts/python.exe -m pytest tests/test_trim_gsv_refs.py -v`
Expected: 4 passed

- [ ] **Step 6: Produce the references and validate they're all legal**

Run:
```bash
cd /c/.Beni/voice
../voice-runtime/gptsovits/.venv/Scripts/python.exe build/trim_gsv_refs.py
../voice-runtime/gptsovits/.venv/Scripts/python.exe -c "import soundfile as sf,glob; [print(f'{sf.info(p).duration:5.2f}s  {p}') for p in sorted(glob.glob('clips/emotions/gsv-refs/*.wav'))]"
```
Expected: ~16 references printed, **every duration between 3.0 and 10.0s**. Spot-listen to `sad.wav` and `happy_long.wav` — clean windows of her voice, not silence.

- [ ] **Step 7: Commit** (script + tests only; refs are gitignored)

```bash
cd /c/.Beni
git add voice/build/trim_gsv_refs.py voice/tests/conftest.py voice/tests/test_trim_gsv_refs.py
git commit -m "feat(voice): build step trims emotion anchors to 3-10s GPT-SoVITS references

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `anchors.py` — resolve by tone against the reference set

**Files:**
- Modify: `voice/anchors.py:84-93` (generalize `resolve_ref`), add `load_gsv_refs`
- Create: `voice/tests/test_anchors.py`

**Interfaces:**
- Consumes: `voice/clips/emotions/gsv-refs/*.wav` (Task 2).
- Produces: `resolve_ref(mood: str, lib: dict | None = None) -> tuple[str, dict]` — backward-compatible (defaults to `load_emotions()`); walks `ANCHOR_FOR → mood → MOOD_FALLBACK → DEFAULT_MOOD → neutral` and returns the first clip present in `lib`.
- Produces: `load_gsv_refs() -> dict` — `{name: {"audio": "clips/emotions/gsv-refs/<name>.wav"}}` for every produced reference. Consumed by Task 4's backend.

- [ ] **Step 1: Write the failing tests**

Create `voice/tests/test_anchors.py`:
```python
import anchors


def test_resolve_ref_uses_passed_lib():
    lib = {"teasing": {"audio": "x/teasing.wav"}}
    name, ref = anchors.resolve_ref("teasing", lib)
    assert name == "teasing"
    assert ref["audio"] == "x/teasing.wav"


def test_resolve_ref_falls_back_within_lib():
    # 'belittling' clip absent -> MOOD_FALLBACK -> 'lecturing'
    lib = {"lecturing": {"audio": "x/lecturing.wav"}, "neutral": {"audio": "x/n.wav"}}
    name, ref = anchors.resolve_ref("belittling", lib)
    assert name == "lecturing"


def test_resolve_ref_defaults_to_full_library():
    name, ref = anchors.resolve_ref("neutral")     # no lib passed
    assert ref and "audio" in ref                  # resolves against load_emotions()


def test_load_gsv_refs_lists_only_existing(tmp_path, monkeypatch):
    refs = tmp_path / "gsv-refs"
    refs.mkdir()
    (refs / "neutral.wav").write_bytes(b"RIFF")
    (refs / "teasing.wav").write_bytes(b"RIFF")
    monkeypatch.setattr(anchors, "GSV_REFS", refs)
    lib = anchors.load_gsv_refs()
    assert set(lib) == {"neutral", "teasing"}
    assert lib["neutral"]["audio"].endswith("gsv-refs/neutral.wav")
```

- [ ] **Step 2: Run, verify failure**

Run: `cd /c/.Beni/voice && ../voice-runtime/gptsovits/.venv/Scripts/python.exe -m pytest tests/test_anchors.py -v`
Expected: FAIL — `test_resolve_ref_uses_passed_lib` errors (resolve_ref takes 1 arg) and `load_gsv_refs`/`GSV_REFS` don't exist.

- [ ] **Step 3: Implement the changes**

In `voice/anchors.py`, add near the `CLIPS` definition (after line 19):
```python
GSV_REFS = CLIPS / "emotions" / "gsv-refs"
```

Add this function (after `load_nonverbal`):
```python
def load_gsv_refs() -> dict:
    """The trimmed 3-10s references, as a mood->clip library for resolve_ref.
    Audio-only (ref-free), so no transcript is carried."""
    if not GSV_REFS.exists():
        return {}
    return {p.stem: {"audio": f"clips/emotions/gsv-refs/{p.name}"}
            for p in sorted(GSV_REFS.glob("*.wav"))}
```

Replace `resolve_ref` (lines 84-93) with:
```python
def resolve_ref(mood: str, lib: dict | None = None) -> tuple[str, dict]:
    """The clip for a mood, falling back through nearby registers so a missing
    anchor degrades to something adjacent instead of breaking playback.

    `lib` defaults to the full emotion library; the GPT-SoVITS backend passes the
    trimmed gsv-refs set so unusable clips fall through to a usable neighbour."""
    if lib is None:
        lib = load_emotions()
    chain = [ANCHOR_FOR.get(mood), mood, *MOOD_FALLBACK.get(mood, []),
             DEFAULT_MOOD, "neutral", "sass", "default"]
    for m in chain:
        if m and m in lib:
            return (mood if m == ANCHOR_FOR.get(mood) else m), lib[m]
    return (next(iter(lib)), next(iter(lib.values()))) if lib else ("", {})
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd /c/.Beni/voice && ../voice-runtime/gptsovits/.venv/Scripts/python.exe -m pytest tests/test_anchors.py -v`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
cd /c/.Beni
git add voice/anchors.py voice/tests/test_anchors.py
git commit -m "feat(voice): resolve_ref accepts a library; add load_gsv_refs

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `backends/gptsovits.py` — the backend

**Files:**
- Create: `voice/backends/gptsovits.py`

**Interfaces:**
- Consumes: `anchors.resolve_ref`, `anchors.load_gsv_refs`, `anchors.path_of`.
- Produces: module with `NAME = "gptsovits"`, `SR_HINT = 32000`, `load()`, and `synth(text: str, mood: str) -> tuple[np.ndarray, int]` returning float32 samples at 32000 Hz. Consumed by `server.py`'s `load_backend`/`render`.

- [ ] **Step 1: Write the backend**

Create `voice/backends/gptsovits.py`:
```python
"""Her voice by cloning — GPT-SoVITS v2, reference-free, the everyday path.

Like the Qwen backend, the mood selects one of her own clips as the timbre
reference; unlike it, GPT-SoVITS is fast (~1.6s a sentence on the GPU, ~3.2s on
CPU) and needs no transcript — ref-free mode clones from the audio alone, so the
anchors' rough transcripts never matter.

Runs in its own venv (voice-runtime/gptsovits/.venv) chosen by Beni.bat. The
model is v2 because ref-free is blocked on v3/v4.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

from anchors import load_gsv_refs, path_of, resolve_ref

HERE = Path(__file__).resolve().parent.parent      # voice/
ROOT = HERE.parent                                 # repo root
RUNTIME = ROOT / "voice-runtime" / "gptsovits"
REPO = RUNTIME / "repo"
PM = REPO / "GPT_SoVITS" / "pretrained_models"

NAME = "gptsovits"
SR_HINT = 32000        # v2 output rate

# UTF-8 so GPT-SoVITS' phoneme/frontend prints don't crash the cp1252 console.
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

_pipe = None
_refs: dict | None = None


def _patch_torchaudio() -> None:
    """torchaudio 2.11 routes I/O through torchcodec, which needs FFmpeg shared
    DLLs this box lacks. Every file here is WAV, so soundfile covers it."""
    import numpy as np
    import soundfile as sf
    import torch
    import torchaudio

    def _load(fp, *a, **k):
        data, sr = sf.read(str(fp), dtype="float32", always_2d=True)
        return torch.from_numpy(np.ascontiguousarray(data.T)), sr

    def _save(fp, src, sample_rate, *a, **k):
        arr = src.detach().cpu().numpy() if hasattr(src, "detach") else np.asarray(src)
        sf.write(str(fp), arr.T if arr.ndim == 2 else arr, int(sample_rate))

    class _Info:
        def __init__(self, i):
            self.sample_rate, self.num_frames, self.num_channels = i.samplerate, i.frames, i.channels

    torchaudio.load = _load
    torchaudio.save = _save
    torchaudio.info = lambda fp, *a, **k: _Info(sf.info(str(fp)))


def _device() -> str:
    """CUDA when the card has room, else CPU — Cydonia-24B usually owns it."""
    try:
        import torch
        free, _ = torch.cuda.mem_get_info()
        return "cuda" if free > 2.5 * 1024**3 else "cpu"
    except Exception:
        return "cpu"


def load():
    """Bring up v2. Deferred so importing this module stays cheap."""
    global _pipe
    if _pipe is not None:
        return _pipe

    for p in (PM / "gsv-v2final-pretrained" / "s2G2333k.pth",
              PM / "chinese-roberta-wwm-ext-large", PM / "chinese-hubert-base"):
        if not p.exists():
            raise RuntimeError(f"missing GPT-SoVITS v2 asset: {p}")

    _patch_torchaudio()
    sys.path.insert(0, str(REPO / "GPT_SoVITS"))
    os.chdir(REPO)
    from TTS_infer_pack.TTS import TTS, TTS_Config

    dev = _device()
    cfg = {"custom": {
        "device": dev, "is_half": dev == "cuda", "version": "v2",
        "t2s_weights_path": str(PM / "gsv-v2final-pretrained" /
                                "s1bert25hz-5kh-longer-epoch=12-step=369668.ckpt"),
        "vits_weights_path": str(PM / "gsv-v2final-pretrained" / "s2G2333k.pth"),
        "bert_base_path": str(PM / "chinese-roberta-wwm-ext-large"),
        "cnhuhbert_base_path": str(PM / "chinese-hubert-base"),
    }}
    _pipe = TTS(TTS_Config(cfg))
    print(f"GPT-SoVITS v2 ready on {dev}")
    return _pipe


def _reference(mood: str) -> str:
    global _refs
    if _refs is None:
        _refs = load_gsv_refs()
    _, ref = resolve_ref(mood, _refs)
    if not ref:
        raise RuntimeError("no gsv references — run voice/build/trim_gsv_refs.py")
    return str(path_of(ref))


def synth(text: str, mood: str):
    """One sentence, cloned through the tone's reference (audio only).

    cut5 splits a long input at punctuation through the same reference, so
    nothing is truncated; a short sentence passes through whole."""
    import numpy as np

    pipe = load()
    inp = {
        "text": text, "text_lang": "en",
        "ref_audio_path": _reference(mood), "prompt_text": "", "prompt_lang": "en",
        "text_split_method": "cut5", "batch_size": 1, "speed_factor": 1.0,
        "return_fragment": False,
    }
    sr, chunks = SR_HINT, []
    for s, a in pipe.run(inp):
        sr = s
        chunks.append(a)
    audio = np.concatenate(chunks) if chunks else np.zeros(1, dtype="float32")
    audio = np.asarray(audio)
    if audio.dtype.kind == "i":              # GPT-SoVITS hands back int16
        audio = audio.astype("float32") / 32768.0
    return np.asarray(audio, dtype="float32"), int(sr)
```

- [ ] **Step 2: Smoke gate — load + synth two moods, listen**

Run:
```bash
cd /c/.Beni/voice
PYTHONIOENCODING=utf-8 ../voice-runtime/gptsovits/.venv/Scripts/python.exe -c "
import sys; sys.path.insert(0,'.')
import backends.gptsovits as b, soundfile as sf, time
for mood in ('teasing','angry'):
    t=time.perf_counter(); s,sr=b.synth('So you actually think this is going to work?', mood)
    sf.write(f'../voice-runtime/gptsovits/smoke-{mood}.wav', s, sr)
    print(mood, 'sr', sr, 'dur', round(len(s)/sr,2), 'gen', round(time.perf_counter()-t,2))
"
```
Expected: both print `sr 32000`, non-zero duration; `smoke-teasing.wav` and `smoke-angry.wav` sound like Beni in two different registers (by ear).

- [ ] **Step 3: Commit**

```bash
cd /c/.Beni
git add voice/backends/gptsovits.py
git commit -m "feat(voice): GPT-SoVITS v2 ref-free backend, clone-by-mood

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: `server.py` — per-sentence mood

**Files:**
- Modify: `voice/server.py` — add `_split_merge` + `segment_reply`; change `shape` signature; rewrite `render`; update `_speak` mood/lead/cache; argparse.
- Create: `voice/tests/test_segment_reply.py`

**Interfaces:**
- Consumes: existing `pick_mood`, `PACING`, `RATE`, `PITCH`, `SARCASTIC`, `MIN_CHUNK`, `DEFAULT_*` in `server.py`.
- Produces: `segment_reply(raw: str, forced_mood: str = "") -> list[tuple[str, str]]` — ordered `(sentence, mood)` pairs. Consumed within `_speak`.

- [ ] **Step 1: Write the failing tests**

Create `voice/tests/test_segment_reply.py`:
```python
import server


def test_single_mood_reply_one_pair_per_sentence():
    pairs = server.segment_reply('"Get out. Now."')
    assert [s for s, _ in pairs] == ["Get out.", "Now."]
    assert all(isinstance(m, str) and m for _, m in pairs)


def test_forced_mood_overrides_all_sentences():
    pairs = server.segment_reply('"Hello there. How nice."', forced_mood="angry")
    assert pairs and all(m == "angry" for _, m in pairs)


def test_local_direction_gives_per_sentence_mood():
    # angry beat before the first line, soft/sad beat before the second
    raw = '*She snaps, furious.* "Get away from me." *Then, quietly, she looks away.* "...just go."'
    pairs = server.segment_reply(raw)
    moods = [m for _, m in pairs]
    assert moods[0] == "angry"
    assert moods[-1] in ("sad", "neutral", "touched")
    assert moods[0] != moods[-1]


def test_empty_input_returns_empty():
    assert server.segment_reply("*shrugs*") == []
```

- [ ] **Step 2: Run, verify failure**

Run: `cd /c/.Beni/voice && ../voice-runtime/gptsovits/.venv/Scripts/python.exe -m pytest tests/test_segment_reply.py -v`
Expected: FAIL — `AttributeError: module 'server' has no attribute 'segment_reply'`

- [ ] **Step 3: Add `_split_merge` and `segment_reply`**

In `voice/server.py`, add after `chunk_sentences` (after line 231). `_split_merge` is the mood-independent split+merge extracted from `chunk_sentences`:
```python
def _split_merge(spoken: str) -> list[str]:
    """Sentence split, gluing fragments shorter than MIN_CHUNK to the next, so a
    lone 'Stop.' doesn't synthesize as a clipped bark. Mood-independent."""
    raw = [s.strip() for s in re.split(r"(?<=[.!?…])\s+", spoken) if s.strip()]
    merged: list[str] = []
    for s in raw:
        if merged and len(merged[-1]) < MIN_CHUNK:
            merged[-1] = f"{merged[-1]} {s}"
        else:
            merged.append(s)
    if len(merged) > 1 and len(merged[-1]) < MIN_CHUNK:
        tail = merged.pop()
        merged[-1] = f"{merged[-1]} {tail}"
    return merged


def _ordered_segments(raw: str) -> list[tuple[str, str]]:
    """Walk the reply preserving order: ('speech'|'dir', text). Quotes mark
    speech when present; otherwise *stars* mark stage directions."""
    segs: list[tuple[str, str]] = []
    if re.search(r'"[^"]{2,}"', raw):
        pos = 0
        for m in re.finditer(r'"([^"]{2,})"', raw):
            if raw[pos:m.start()].strip():
                segs.append(("dir", raw[pos:m.start()]))
            segs.append(("speech", m.group(1)))
            pos = m.end()
        if raw[pos:].strip():
            segs.append(("dir", raw[pos:]))
    else:
        pos = 0
        for m in re.finditer(r"\*([^*]*)\*", raw):
            if raw[pos:m.start()].strip():
                segs.append(("speech", raw[pos:m.start()]))
            if m.group(1).strip():
                segs.append(("dir", m.group(1)))
            pos = m.end()
        if raw[pos:].strip():
            segs.append(("speech", raw[pos:]))
    return segs


def segment_reply(raw: str, forced_mood: str = "") -> list[tuple[str, str]]:
    """Ordered (sentence, mood) pairs. Each sentence's mood is scored on its own
    words plus the nearest stage-direction beat before it, so one reply can
    change register between sentences. A forced mood applies to every sentence."""
    tidy = lambda s: re.sub(r"\s+", " ", s).strip()
    segs = _ordered_segments(raw)
    reply_desc = tidy(" ".join(t for k, t in segs if k == "dir"))
    pairs: list[tuple[str, str]] = []
    recent = ""
    for kind, text in segs:
        if kind == "dir":
            recent = tidy(text)
            continue
        for sent in _split_merge(tidy(text)):
            mood = forced_mood or pick_mood(sent, recent or reply_desc)
            if mood in SARCASTIC:
                sent = re.sub(r"\?(\s*)$", r".\1", sent)
            pairs.append((sent, mood))
    return pairs
```

- [ ] **Step 4: Run the new tests, verify pass**

Run: `cd /c/.Beni/voice && ../voice-runtime/gptsovits/.venv/Scripts/python.exe -m pytest tests/test_segment_reply.py -v`
Expected: 4 passed

- [ ] **Step 5: Thread per-sentence mood through `shape`, `render`, `_speak`**

In `voice/server.py`:

(a) `shape` — change the signature to take pitch/rate (replace lines 431 and 442, and remove the closure dependence). Change `def shape(s, sr: int):` to:
```python
        def shape(s, sr: int, pitch: float, rate: float):
```
and change its guard line `if abs(pitch - 1.0) < 0.005 and abs(rate - 1.0) < 0.005:` — it already references `pitch`/`rate`, now the parameters. No other change inside `shape`.

(b) `render` — replace the function (lines 473-487) with:
```python
        def render(parts):
            """Sentence-by-sentence, each in its own mood: gap, tempo, pitch and
            reference all come from that sentence's register."""
            chunks, sr = [], getattr(backend, "SR_HINT", 24000)
            for sent, m in parts:
                if not sent.strip():
                    continue
                s, sr = synth_raw(sent.strip(), m)
                s = shape(trim_lead(np.asarray(s, dtype="float32"), sr), sr,
                          PITCH.get(m, DEFAULT_PITCH), RATE.get(m, DEFAULT_RATE))
                chunks.append(s)
                chunks.append(np.zeros(int(sr * PACING.get(m, DEFAULT_GAP)), dtype=s.dtype))
            joined = np.concatenate(chunks) if chunks else np.zeros(1, dtype="float32")
            buf = io.BytesIO()
            sf.write(buf, joined, sr, format="WAV")
            return buf.getvalue(), joined, sr
```

(c) `synth_raw` — add the mood parameter (replace lines 417 and 426). Change `def synth_raw(t: str):` to `def synth_raw(t: str, m: str):` and `return backend.synth(t, mood)` to `return backend.synth(t, m)`.

(d) `_speak` head — replace lines 373-391 (from `spoken, descriptor = ...` through the `pitch = PITCH.get(...)` block) with:
```python
        spoken, descriptor = split_speech(raw)
        if not spoken:
            raise ValueError("nothing to say")

        forced = str(req.get("mood") or "").strip()
        pairs = segment_reply(raw, forced)
        if not pairs:
            raise ValueError("nothing to say")

        # the reply opens in the first sentence's register; a laugh leads with
        # the real clip and the first line then speaks in a normal register
        opening = pairs[0][1]
        laughs = opening == LAUGH_ANCHOR and LAUGH_ANCHOR in load_emotions()
        if laughs:
            pairs[0] = (pairs[0][0], LAUGH_SPEECH_MOOD)
        lead_sound = "" if laughs else pick_nonverbal(descriptor)
        reported = opening
```
Delete the now-unused `mood`, `detected`, `gap`, `rate`, `pitch` locals (gap/rate/pitch are now per-sentence inside `render`).

(e) `cache_key` — replace lines 397-398 with:
```python
        cache_key = hashlib.sha1(
            f"{backend.NAME}|{forced or 'auto'}|{raw}".encode()).hexdigest()[:16]
```

(f) `sentences = chunk_sentences(spoken, mood)` (line 519) → replace with `sentences = pairs`. The `render(sentences[:1])`, lead block, and `render(sentences[1:])` all now operate on `(sentence, mood)` pairs unchanged.

- [ ] **Step 6: Update argparse to default gptsovits (lines 574-576)**

Replace:
```python
    ap.add_argument("--backend", default="gptsovits",
                    choices=["gptsovits", "rvc", "qwen"],
                    help="gptsovits (default, natural), rvc (fast), qwen (dormant)")
```

- [ ] **Step 7: Re-run all pytest to confirm nothing regressed**

Run: `cd /c/.Beni/voice && ../voice-runtime/gptsovits/.venv/Scripts/python.exe -m pytest tests/ -v`
Expected: all tests pass (trim, anchors, segment_reply).

- [ ] **Step 8: End-to-end by-ear gate — start the server, speak a per-sentence-mood reply**

Run (server in one shell):
```bash
cd /c/.Beni/voice
PYTHONIOENCODING=utf-8 ../voice-runtime/gptsovits/.venv/Scripts/python.exe server.py --backend gptsovits
```
Then in another shell:
```bash
curl -s -X POST http://127.0.0.1:5002/speak -H "content-type: application/json" \
  -d '{"text":"*She snaps, furious.* \"You actually think this will work?\" *Then, quieter, she looks away.* \"...whatever. Do what you want.\""}' \
  -D - -o /c/.Beni/voice-runtime/gptsovits/e2e-first.wav | grep -i "x-voice"
```
Expected: response headers include `x-voice-mood: angry` and (if >1 sentence) `x-voice-rest`; `e2e-first.wav` plays the first sentence in her voice. Fetch the remainder via `GET /rest/<x-voice-rest>` and confirm the later "…whatever" line is delivered in a softer register than the angry opener — audibly different, cloned through different references.

- [ ] **Step 9: Commit**

```bash
cd /c/.Beni
git add voice/server.py voice/tests/test_segment_reply.py
git commit -m "feat(voice): per-sentence mood; default backend gptsovits

segment_reply scores each sentence on its own words + nearest stage
direction; render/shape/gap now per-sentence. Cache key keyed on raw.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Launchers + full end-to-end verification

**Files:**
- Modify: `Beni.bat:24`
- Create: `Beni-rvc.bat`

**Interfaces:**
- Consumes: the finished `gptsovits` backend and server changes.

- [ ] **Step 1: Point Beni.bat's voice window at GPT-SoVITS (line 24)**

Replace line 24:
```bat
start "Beni - Voice" /d "%~dp0voice" cmd /k ..\voice-runtime\gptsovits\.venv\Scripts\python.exe server.py --backend gptsovits
```
Also update the header comment block (lines 3-16) that describes the voice as "RVC — Windows SAPI": change to "GPT-SoVITS v2 — clones her own clips by tone, :5002" and adjust the latency note to "~1.6s a sentence on the GPU, ~3.2s on CPU; first sentence streams first."

- [ ] **Step 2: Create the dormant RVC launcher**

Create `Beni-rvc.bat` (copy of `Beni.bat` with the voice line pointing at the RVC venv/backend):
```bat
@echo off
rem ============================================================
rem  BENI (RVC voice) — the fast, dormant fallback. Timbre-swap
rem  through Windows SAPI: ~0.8s a line, ~1.5 GB VRAM, but robotic
rem  next to GPT-SoVITS. Use Beni.bat for the everyday voice.
rem ============================================================
cd /d "%~dp0"
start "Beni - Model" cmd /k tools\koboldcpp.exe --model models\TheDrummer_Cydonia-24B-v4.3-IQ4_XS.gguf --usecublas normal --gpulayers 999 --contextsize 16384 --flashattention --quantkv 1 --port 5001
start "Beni - Voice (RVC)" /d "%~dp0voice" cmd /k ..\voice-runtime\.venv\Scripts\python.exe server.py --backend rvc
start "Beni - App" cmd /k npm start
start "Beni - Tunnel" cmd /k tools\cloudflared.exe tunnel --config "%USERPROFILE%\.cloudflared\beni-config.yml" run beni
timeout /t 12
```

- [ ] **Step 3: Full end-to-end gate through the app**

Start `Beni.bat`. Wait for the model (~60s) and the voice window to print `GPT-SoVITS v2 ready on <device>`. In the app (http://localhost:3001), send a message that provokes a multi-sentence reply and confirm:
- she speaks unprompted (auto-speak) in her cloned voice, not robotic;
- a long reply plays **to the end**, no sentence dropped (no-cutoff);
- sending the identical message again replays **instantly** (cache);
- the voice console logs a per-sentence mood line for a register-shifting reply.

- [ ] **Step 4: Latency gate, measured through the server**

With the model loaded (GPU contended, so backend on CPU), time first-audio:
```bash
curl -s -o /dev/null -w "first-audio: %{time_total}s\n" -X POST http://127.0.0.1:5002/speak \
  -H "content-type: application/json" -d '{"text":"\"So what exactly is your plan here, genius?\""}'
```
Expected: first-audio ≈ 3s or better on CPU (≈1.6s if the card was free). Record the number.

- [ ] **Step 5: Backend isolation gate**

Start `Beni-rvc.bat`; confirm its voice window comes up on `--backend rvc` and speaks (the RVC path is untouched and still works). Stop it. This proves the GPT-SoVITS deps never leaked into the RVC venv.

- [ ] **Step 6: Commit**

```bash
cd /c/.Beni
git add Beni.bat Beni-rvc.bat
git commit -m "feat: Beni.bat launches GPT-SoVITS voice; add dormant Beni-rvc.bat

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-review notes

- **Spec coverage:** backend (Task 4), ref-free v2 (Task 4 config + `prompt_text=""`), reference trim 3-10s (Task 2), tone→clip via mood engine (Task 3), per-sentence mood (Task 5), no-cutoff (Task 4 `cut5` + Task 5 per-sentence render), retire RVC/dormant + runtime promotion + launchers (Tasks 1, 6), dynamic device (Task 4 `_device`), Windows fixes (Task 4), latency/isolation gates (Task 6). All spec sections map to a task.
- **Deferred (spec "out of scope"):** fine-tuning, v2Pro/v3/v4, text-matched transcripts, hard-deleting rvc.py — none planned, by design.
- **Type consistency:** `synth(text, mood)->(np.float32, 32000)` consistent across Task 4 (producer) and Task 5 `render`/`synth_raw` (consumer); `resolve_ref(mood, lib=None)` and `load_gsv_refs()->{name:{"audio":...}}` consistent across Tasks 3-4; `segment_reply(raw, forced_mood="")->[(sentence, mood)]` consistent across Task 5 producer and `_speak` consumer.

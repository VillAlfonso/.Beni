"""Build GPT-SoVITS-safe audio-only references from Beni's emotion anchors.

GPT-SoVITS v2 accepts references only between three and ten seconds.  This
keeps the first clean sustained voiced run from each usable emotion clip, with
longer clips limited to 9.5 seconds.  Pure laughter and cut-off fragments stay
out of the library: the voice server already plays those as real non-verbal
leads, while speech falls back to the nearest usable tone.

Output is derived audio and intentionally ignored by git:
``voice/clips/emotions/gsv-refs/<mood>.wav``.

Run from ``voice/`` with the GPT-SoVITS interpreter:
``..\\voice-runtime\\gptsovits\\.venv\\Scripts\\python.exe build\\trim_gsv_refs.py``
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import soundfile as sf

HERE = Path(__file__).resolve().parent.parent
EMOTIONS = HERE / "clips" / "emotions"
OUT = EMOTIONS / "gsv-refs"

# These either contain no spoken reference or are an unfinished word fragment.
SKIP = {"laughing", "laugh2", "teasing_aww", "defensive", "shouting2"}


def voiced_window(y, sr: int, lo: float = 3.0, hi: float = 9.5):
    """Return a clean ``lo``--``hi`` second voiced window, or ``None``.

    The start is the first run of at least 120 ms above a relative RMS floor.
    Starting there removes episode-leading silence without attempting fragile
    transcript alignment.  If the final voiced run is shorter than ``lo``, it
    is still rejected rather than padded: GPT-SoVITS needs actual voice.
    """
    y = np.asarray(y, dtype="float32")
    if y.ndim > 1:
        y = y.mean(axis=1)
    if sr <= 0 or len(y) < int(sr * lo):
        return None

    hop = max(1, int(sr * 0.02))
    frames = np.array(
        [np.sqrt(np.mean(y[i : i + hop] ** 2)) for i in range(0, len(y) - hop + 1, hop)],
        dtype="float32",
    )
    if not len(frames) or frames.max() <= 0:
        return None

    voiced = frames > frames.max() * 0.10
    run = 0
    start = None
    for i, is_voiced in enumerate(voiced):
        run = run + 1 if is_voiced else 0
        if run * hop >= int(sr * 0.12):
            start = max(0, i - run + 1) * hop
            break
    if start is None:
        return None

    end = min(len(y), start + int(sr * hi))
    window = y[start:end]
    if len(window) >= int(sr * lo):
        return window

    # A three-second clip can be legal before removing a tiny lead-in but too
    # short afterwards.  Keep that original legal reference rather than
    # throwing away a complete spoken register such as ``flustered``.
    whole = y[: min(len(y), int(sr * hi))]
    return whole if len(whole) >= int(sr * lo) else None


def main() -> None:
    manifest = json.loads((HERE / "clips" / "beni-emotions.json").read_text(encoding="utf-8"))
    OUT.mkdir(parents=True, exist_ok=True)
    kept: list[tuple[str, float]] = []
    dropped: list[tuple[str, str]] = []

    for mood, ref in manifest.items():
        if mood in SKIP:
            dropped.append((mood, "non-verbal or fragment"))
            continue
        source = HERE / ref["audio"]
        if not source.exists():
            dropped.append((mood, "missing audio"))
            continue
        samples, sr = sf.read(source, dtype="float32")
        window = voiced_window(samples, int(sr))
        if window is None:
            dropped.append((mood, "under 3s after voiced start"))
            continue
        target = OUT / f"{mood}.wav"
        sf.write(target, window, int(sr))
        kept.append((mood, len(window) / sr))

    print("kept:", ", ".join(f"{name} ({seconds:.2f}s)" for name, seconds in kept))
    print("dropped:", ", ".join(f"{name} ({why})" for name, why in dropped))
    print(f"-> {OUT} ({len(kept)} references)")


if __name__ == "__main__":
    main()

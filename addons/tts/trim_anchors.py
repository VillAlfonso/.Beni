"""Trim stray lead-ins off the emotion anchors.

Cuts made by hand off a video land a fraction early, so several anchors open on
the tail of the previous word or a stray syllable — and voice cloning faithfully
reproduces it, which is where the little "oh" at the front of happy and excited
came from.

Rule: find the first sustained speech run (>= MIN_RUN), keep a short pre-roll,
drop everything before it. Leading silence goes too, which helps cloning anyway.
Originals are preserved in voice/emotions/untrimmed/ so this is reversible.

Run: .venv\\Scripts\\python.exe trim_anchors.py
"""
from __future__ import annotations

import shutil
from pathlib import Path

import numpy as np
import soundfile as sf

ADDON = Path(__file__).resolve().parent
EMO = ADDON / "voice" / "emotions"
BACKUP = EMO / "untrimmed"

FRAME = 0.02      # energy frame
MIN_RUN = 0.30    # a real word, not a stray syllable
PREROLL = 0.08    # keep a breath before she starts
REL_THRESH = 0.10 # relative to the clip's peak
MAX_TRIM = 1.50   # a stray lead-in is short; more than this means the detector
                  # got confused by quiet speech before a loud moment
MIN_KEEP = 2.50   # cloning needs a few seconds of reference to work with


def first_real_onset(y: np.ndarray, sr: int) -> float:
    hop = int(sr * FRAME)
    frames = np.array([np.sqrt(np.mean(y[i:i + hop] ** 2)) for i in range(0, len(y) - hop, hop)])
    if not len(frames):
        return 0.0
    voiced = frames > frames.max() * REL_THRESH

    run_start, run_len = 0, 0
    for i, v in enumerate(voiced):
        if v:
            if run_len == 0:
                run_start = i
            run_len += 1
            if run_len * FRAME >= MIN_RUN:
                return max(0.0, run_start * FRAME - PREROLL)
        else:
            run_len = 0
    return 0.0


def main() -> None:
    BACKUP.mkdir(parents=True, exist_ok=True)
    for wav in sorted(EMO.glob("*.wav")):
        # always work from the pristine copy so this is safe to re-run
        if (BACKUP / wav.name).exists():
            shutil.copy2(BACKUP / wav.name, wav)
        y, sr = sf.read(wav)
        if y.ndim > 1:
            y = y.mean(axis=1)
        total = len(y) / sr
        cut = first_real_onset(y, sr)

        if cut < FRAME:
            print(f"  {wav.stem:14s} clean start, untouched")
            continue
        if cut > MAX_TRIM or total - cut < MIN_KEEP:
            print(f"  {wav.stem:14s} SKIPPED — wanted {cut:.2f}s, too much to be a stray lead-in")
            continue

        if not (BACKUP / wav.name).exists():
            shutil.copy2(wav, BACKUP / wav.name)
        sf.write(wav, y[int(cut * sr):], sr)
        print(f"  {wav.stem:14s} trimmed {cut:.2f}s  ({total:.1f}s -> {total - cut:.1f}s)")
    print(f"\noriginals kept in {BACKUP}")


if __name__ == "__main__":
    main()

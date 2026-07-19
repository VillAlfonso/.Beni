"""Fuse user-confirmed clips (from mine_voice.py) into a clean voice profile.

Concatenates the chosen clips, runs pyannote on the single-voice result, and
merges the dominant speaker's embedding into voices/enrolled.npz.

Usage: python enroll_clips.py Chooki 0,2,5
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import numpy as np

import diarize_match as dm

HERE = Path(__file__).resolve().parent
MINE = HERE / "review_mine"
VOICES = HERE / "voices" / "enrolled.npz"
FFMPEG = "C:/ffmpeg/ffmpeg"


def main() -> None:
    name = sys.argv[1]
    picks = [int(x) for x in sys.argv[2].split(",") if x.strip() != ""]
    src = MINE / name
    clips = [src / f"clip{i:02d}.wav" for i in picks]
    clips = [c for c in clips if c.exists()]
    if not clips:
        raise SystemExit("no valid clips picked")

    concat = src / "_fused.wav"
    listfile = src / "_list.txt"
    listfile.write_text("\n".join(f"file '{c.name}'" for c in clips), encoding="utf-8")
    subprocess.run([FFMPEG, "-y", "-v", "error", "-f", "concat", "-safe", "0",
                    "-i", str(listfile), "-ac", "1", "-ar", "16000", str(concat)], check=True)

    _, spk_emb = dm.diarize_pyannote(concat)
    if not spk_emb:
        raise SystemExit("pyannote found no speaker in the fused audio")
    # dominant = first labeled speaker (single-voice audio → one speaker expected)
    vec = list(spk_emb.values())[0]

    existing: dict[str, np.ndarray] = {}
    if VOICES.exists():
        old = np.load(VOICES)
        existing = {n: old[n] for n in old.files}
    if name in existing and existing[name].shape == vec.shape:
        merged = (existing[name] + vec) / 2
        existing[name] = merged / (np.linalg.norm(merged) + 1e-9)
        print(f"updated profile: {name}")
    else:
        existing[name] = vec
        print(f"new profile: {name}")
    VOICES.parent.mkdir(exist_ok=True)
    np.savez(VOICES, **existing)
    print(f"saved {len(existing)} profiles -> {VOICES}")
    print("now rerun: name_transcripts.py, annotate_address.py, export_readable.py")


if __name__ == "__main__":
    main()

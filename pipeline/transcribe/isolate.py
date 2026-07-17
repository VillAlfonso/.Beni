"""Vocal isolation (demucs htdemucs, GPU) so Whisper's VAD and the ECAPA voice
embeddings hear clean speech instead of the music bed. Writes
work/epNN.vocals.wav (16k mono), time-aligned 1:1 with the original — all
existing timestamps stay valid. transcribe.py and diarize_match.py
automatically prefer the vocals file when it exists.

Usage: python isolate.py [--only 14]
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
EPISODES = ROOT / "data" / "episodes"
WORK = HERE / "work"
TMP = WORK / "sep"
FFMPEG = "C:/ffmpeg/ffmpeg"
PY = sys.executable

MEDIA_EXT = (".mp4", ".mkv", ".avi", ".webm")


def media_for(ep: int) -> Path | None:
    for ext in MEDIA_EXT:
        p = EPISODES / f"ep{ep}{ext}"
        if p.exists():
            return p
    return None


def isolate(ep: int) -> None:
    out = WORK / f"ep{ep:02d}.vocals.wav"
    if out.exists():
        print(f"ep{ep:02d}: vocals exist, skip")
        return
    media = media_for(ep)
    if not media:
        return
    print(f"ep{ep:02d}: separating vocals…")
    TMP.mkdir(parents=True, exist_ok=True)
    hi = TMP / f"ep{ep:02d}.wav"
    subprocess.run([FFMPEG, "-y", "-v", "error", "-i", str(media), "-ac", "2", "-ar", "44100", "-vn", str(hi)], check=True)
    subprocess.run([PY, "-m", "demucs", "--two-stems", "vocals", "-n", "htdemucs", "-o", str(TMP), str(hi)], check=True)
    voc = TMP / "htdemucs" / hi.stem / "vocals.wav"
    subprocess.run([FFMPEG, "-y", "-v", "error", "-i", str(voc), "-ac", "1", "-ar", "16000", str(out)], check=True)
    hi.unlink(missing_ok=True)
    shutil.rmtree(TMP / "htdemucs" / hi.stem, ignore_errors=True)
    print(f"ep{ep:02d}: -> {out.name}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", type=int, default=None)
    args = ap.parse_args()
    eps = [args.only] if args.only else [
        ep for ep in range(1, 60) if media_for(ep) is not None
    ]
    for ep in eps:
        isolate(ep)


if __name__ == "__main__":
    main()

"""Generate English .srt subtitles from the speaker-attributed transcripts.

Lets any episode be WATCHED with English subs, speaker names included.
Output lands next to the video: C:\\.webdownloader\\epNN.en.srt
(players like VLC/MPC auto-load it when the name matches the video).

Usage: python make_subs.py 49 50 51 52      (file numbers)
       python make_subs.py --all
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
WORK = HERE / "work"
ROOT = HERE.parents[1]
OUT = ROOT / "data" / "transcripts"
VIDEO_DIR = Path("C:/.webdownloader")


def ts(t: float) -> str:
    h = int(t // 3600)
    m = int(t % 3600 // 60)
    s = int(t % 60)
    ms = int((t - int(t)) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def build(file_ep: int) -> bool:
    # prefer the final named transcript; fall back to the aligned one
    src = OUT / f"ep{file_ep:02d}.json"
    if not src.exists():
        src = WORK / f"ep{file_ep:02d}.aligned.json"
    if not src.exists():
        print(f"ep{file_ep:02d}: no transcript yet")
        return False
    lines = json.loads(src.read_text(encoding="utf-8"))["lines"]

    blocks = []
    for i, ln in enumerate(lines, 1):
        spk = ln["speaker"]
        name = "" if spk.startswith(("UNKNOWN", "SPEAKER")) else f"{spk.replace('_', ' ')}: "
        end = ln["t1"]
        if i < len(lines):
            end = min(end, lines[i]["t0"] - 0.05) if lines[i]["t0"] > ln["t0"] else end
        end = max(end, ln["t0"] + 0.8)
        blocks.append(f"{i}\n{ts(ln['t0'])} --> {ts(end)}\n{name}{ln['text']}\n")

    dest = VIDEO_DIR / f"ep{file_ep}.en.srt"
    dest.write_text("\n".join(blocks), encoding="utf-8")
    print(f"ep{file_ep:02d}: {len(blocks)} subs -> {dest}")
    return True


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("eps", nargs="*", type=int)
    ap.add_argument("--all", action="store_true")
    a = ap.parse_args()
    eps = a.eps or ([int(f.stem[2:4]) for f in sorted(OUT.glob("ep*.json")) if f.stem[2:4].isdigit()] if a.all else [49, 50, 51, 52])
    for e in eps:
        build(e)


if __name__ == "__main__":
    main()

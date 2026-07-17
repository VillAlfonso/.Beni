"""Step 4: frame captures of Beni's on-screen moments.

After diarize_match has labeled transcripts, grab a video frame at the midpoint
of every Beni line and write an index pairing each frame with the line she was
delivering and its scene tag. Uses: image-LoRA dataset (P4), and studying her
facial expressions / body language per emotional beat for the world bible.

Skips episodes whose transcripts have no labeled Beni lines yet.

Usage: python beni_frames.py [--only 14] [--speaker Beni]
"""
from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TRANSCRIPTS = ROOT / "data" / "transcripts"
EPISODES = ROOT / "data" / "episodes"
OUT = ROOT / "data" / "images" / "beni-frames"
FFMPEG = "C:/ffmpeg/ffmpeg"

MEDIA_EXT = (".mp4", ".mkv", ".avi", ".webm")


def media_for(ep: int) -> Path | None:
    for ext in MEDIA_EXT:
        p = EPISODES / f"ep{ep}{ext}"
        if p.exists():
            return p
    return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", type=int, default=None)
    ap.add_argument("--speaker", default="Beni")
    a = ap.parse_args()
    total = 0
    for f in sorted(TRANSCRIPTS.glob("ep*.json")):
        ep = int(f.stem[2:4])
        if a.only and ep != a.only:
            continue
        data = json.loads(f.read_text(encoding="utf-8"))
        lines = [l for l in data["lines"] if l["speaker"] == a.speaker]
        if not lines:
            continue
        media = media_for(ep)
        if not media:
            continue
        outdir = OUT / f"ep{ep:02d}"
        outdir.mkdir(parents=True, exist_ok=True)
        index = []
        for l in lines:
            dur = max(0.0, l["t1"] - l["t0"])
            # sample across the line, not just the midpoint: anime cuts between
            # speaker and listener, so one frame often catches a reaction shot or
            # the back of her head. 3 frames per line raises the odds of a clean
            # Beni shot; the world-bible pass then keeps the good ones.
            fracs = [0.2, 0.5, 0.8] if dur >= 2.0 else [0.5]
            frames = []
            for fr in fracs:
                t = l["t0"] + dur * fr
                name = f"ep{ep:02d}_{t:07.1f}.jpg"
                dest = outdir / name
                if not dest.exists():
                    subprocess.run(
                        [FFMPEG, "-y", "-v", "error", "-ss", f"{t:.2f}", "-i", str(media),
                         "-frames:v", "1", "-q:v", "2", str(dest)],
                        check=False,
                    )
                frames.append(name)
            index.append({"frames": frames, "t0": l["t0"], "t1": l["t1"], "text": l["text"], "scene": l.get("scene", "unknown")})
        (outdir / "index.json").write_text(json.dumps(index, indent=1), encoding="utf-8")
        total += len(index)
        print(f"ep{ep:02d}: {len(index)} {a.speaker} frames")
    print(f"total: {total} frames -> {OUT}")


if __name__ == "__main__":
    main()

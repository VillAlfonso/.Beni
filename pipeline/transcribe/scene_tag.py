"""Step 3: scene/context tags.

Adds a "scene" field to every line of data/transcripts/epNN.json:
    quarton-battle | quarton | earth | unknown

Heuristic: when characters address each other by tenkai names (Bravenwolf,
Tributon, Venetta…) or talk Corekai/Corrupted business, they're on Quarton;
battle is detected from attack/command vocabulary density. Earth cues are
school, the diner, Benham City life. A sliding window votes so one stray
word can't flip the scene, and gaps inherit the previous scene.

Usage: python scene_tag.py [--only 14]
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "transcripts"

QUARTON = [
    "bravenwolf", "tributon", "valorn", "lydendor", "venetta", "dromus",
    "quarton", "corekai", "corrupted", "vilius", "granox", "slyger", "beag",
    "guardian", "boreas", "eurus", "notus", "core brick", "tenkai energy",
    "robofusion", "titan mode", "dragon cube", "portal",
]
BATTLE = [
    "attack", "blast", "shield", "blade", "cannon", "strike", "charge",
    "fall in", "retreat", "fire", "destroy", "battle", "fusion", "titan",
    "take them", "surround", "formation",
]
EARTH = [
    "school", "class", "homework", "teacher", "diner", "benham", "mr. white",
    "shop", "mom", "dad", "sleepover", "downtown", "plaza", "apartment",
    "allowance", "video game", "lunch",
]

WINDOW = 5


def hits(text: str, vocab: list[str]) -> int:
    t = text.lower()
    return sum(1 for w in vocab if re.search(r"\b" + re.escape(w).replace(r"\ ", r"\s+") + r"\b", t))


def tag(lines: list[dict]) -> None:
    q = [hits(l["text"], QUARTON) for l in lines]
    b = [hits(l["text"], BATTLE) for l in lines]
    e = [hits(l["text"], EARTH) for l in lines]
    prev = "unknown"
    for i in range(len(lines)):
        lo, hi = max(0, i - WINDOW), min(len(lines), i + WINDOW + 1)
        qs, bs, es = sum(q[lo:hi]) * 2, sum(b[lo:hi]), sum(e[lo:hi])
        if qs > es and qs >= 2:
            scene = "quarton-battle" if bs >= 2 else "quarton"
        elif es > qs and es >= 2:
            scene = "earth"
        else:
            scene = prev
        lines[i]["scene"] = scene
        prev = scene


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", type=int, default=None)
    args = ap.parse_args()
    files = sorted(OUT.glob("ep*.json"))
    if not files:
        raise SystemExit("No transcripts yet — run diarize_match.py first.")
    for f in files:
        ep = int(f.stem[2:4])
        if args.only and ep != args.only:
            continue
        data = json.loads(f.read_text(encoding="utf-8"))
        tag(data["lines"])
        f.write_text(json.dumps(data, indent=1), encoding="utf-8")
        counts: dict[str, int] = {}
        for l in data["lines"]:
            counts[l["scene"]] = counts.get(l["scene"], 0) + 1
        print(f"ep{ep:02d}: " + ", ".join(f"{k} {v}" for k, v in sorted(counts.items())))


if __name__ == "__main__":
    main()

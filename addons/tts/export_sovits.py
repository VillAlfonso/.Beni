"""Export the existing Beni dataset in GPT-SoVITS training format.

GPT-SoVITS wants a single .list file, one line per clip:

    <absolute wav path>|<speaker>|<language>|<transcript>

Everything it needs already exists in this project: clips are cut, music is
stripped via demucs, audio is 24 kHz mono, and each clip is transcribed. So this
is a format conversion, not new work.

Two exports are written:
  beni.list        every clean clip — the training set
  beni-refs.list   the approved emotion anchors, which become inference-time
                   reference audio (GPT-SoVITS picks emotion by reference clip,
                   so these are the emotion control surface, not training data)

Run: .venv\\Scripts\\python.exe export_sovits.py
"""
from __future__ import annotations

import json
from pathlib import Path

import soundfile as sf

ADDON = Path(__file__).resolve().parent
DATASET = ADDON / "dataset"
OUT = ADDON / "sovits"

SPEAKER = "beni"
LANG = "en"

# GPT-SoVITS trains best on clips in this range; very short clips carry no
# prosody and very long ones destabilise the GPT stage
MIN_SEC, MAX_SEC = 2.0, 10.0


def main() -> None:
    OUT.mkdir(exist_ok=True)

    rows = [json.loads(l) for l in (DATASET / "metadata.jsonl").read_text(encoding="utf-8").splitlines()]
    lines, total = [], 0.0
    skipped = {"unclean": 0, "too_short": 0, "too_long": 0, "no_text": 0}
    for r in rows:
        if not r["clean"]:
            skipped["unclean"] += 1
            continue
        if r["duration"] < MIN_SEC:
            skipped["too_short"] += 1
            continue
        if r["duration"] > MAX_SEC:
            skipped["too_long"] += 1
            continue
        text = (r.get("text") or "").strip()
        if len(text) < 4:
            skipped["no_text"] += 1
            continue
        wav = (DATASET / r["audio"]).resolve()
        if not wav.exists():
            continue
        lines.append(f"{wav}|{SPEAKER}|{LANG}|{text}")
        total += r["duration"]

    (OUT / "beni.list").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"training set : {len(lines)} clips, {total/60:.1f} min -> sovits/beni.list")
    print(f"  skipped: {skipped}")

    # the anchors: emotion control lives here, not in the training set
    emo = json.loads((ADDON / "voice" / "beni-emotions.json").read_text(encoding="utf-8"))
    ref_lines = []
    for tag, e in sorted(emo.items()):
        wav = (ADDON / e["audio"]).resolve()
        if not wav.exists():
            continue
        text = (e.get("text") or "").strip()
        dur = sf.info(wav).duration
        # GPT-SoVITS reference clips must be 3-10s; outside that it errors
        flag = "" if 3.0 <= dur <= 10.0 else f"   <-- {dur:.1f}s, outside the 3-10s reference window"
        ref_lines.append(f"{wav}|{SPEAKER}|{LANG}|{text}")
        print(f"  ref {tag:12s} {dur:5.1f}s{flag}")

    (OUT / "beni-refs.list").write_text("\n".join(ref_lines) + "\n", encoding="utf-8")
    print(f"\nreferences  : {len(ref_lines)} anchors -> sovits/beni-refs.list")


if __name__ == "__main__":
    main()

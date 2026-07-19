"""Build Beni's voice-training dataset (for Qwen3-TTS single-speaker fine-tune).

Gathers every confidently-attributed Beni line, cuts the audio from the
VOCAL-ISOLATED track when available (music bed removed = clean), filters for
training quality, and writes:

    addons/tts/dataset/wavs/ep15_0123.4.wav      (16k mono clips)
    addons/tts/dataset/metadata.jsonl            {"audio": ..., "text": ...}
    addons/tts/dataset/refs/                     ten best clips (cloning refs)

Quality filters: 1.2s-12s, sane text, locked/fused episodes handled, no ads.
Run AFTER isolating her heavy episodes (isolate.py) for best cleanliness.

Usage: ..\\..\\pipeline\\transcribe\\.venv\\Scripts\\python.exe build_dataset.py
"""
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

ADDON = Path(__file__).resolve().parent
ROOT = ADDON.parents[1]
TRANSCRIPTS = ROOT / "data" / "transcripts"
WORK = ROOT / "pipeline" / "transcribe" / "work"
DATASET = ADDON / "dataset"
FFMPEG = "C:/ffmpeg/ffmpeg"

# ep52's diarization fuses her with Ceylan — only her content-verified lines there
FUSED_EPS = {52}
AD = re.compile(r"cartoon network|new episode|beywarriors|see it first", re.I)


def main() -> None:
    wavs = DATASET / "wavs"
    wavs.mkdir(parents=True, exist_ok=True)
    (DATASET / "refs").mkdir(exist_ok=True)

    rows = []
    stats = {"total": 0, "vocals": 0}
    for f in sorted(TRANSCRIPTS.glob("ep*.json")):
        m = re.match(r"ep(\d{2})$", f.stem)
        if not m:
            continue
        ep = int(m.group(1))
        data = json.loads(f.read_text(encoding="utf-8"))
        vocals24 = WORK / f"ep{ep:02d}.vocals24.wav"
        vocals = WORK / f"ep{ep:02d}.vocals.wav"
        raw = WORK / f"ep{ep:02d}.wav"
        src = vocals24 if vocals24.exists() else (vocals if vocals.exists() else raw)
        if not src.exists():
            continue
        clean_src = vocals24.exists() or vocals.exists()
        for ln in data["lines"]:
            if ln["speaker"] != "Beni":
                continue
            dur = ln["t1"] - ln["t0"]
            text = ln["text"].strip()
            if not (1.2 <= dur <= 12) or len(text) < 6 or AD.search(text):
                continue
            if ep in FUSED_EPS and "fix" not in ln and "my own reasons" not in text and "cheesy" not in text:
                continue
            name = f"ep{ep:02d}_{ln['t0']:07.1f}.wav"
            dest = wavs / name
            subprocess.run([FFMPEG, "-y", "-v", "error", "-ss", f"{ln['t0']:.2f}", "-i", str(src),
                            "-t", f"{dur:.2f}", "-ac", "1", "-ar", "24000", str(dest)], check=False)
            if dest.exists():
                rows.append({"audio": f"wavs/{name}", "text": text, "duration": round(dur, 2),
                             "clean": clean_src, "episode": data.get("episode", ep)})
                stats["total"] += 1
                stats["vocals"] += int(clean_src)

    (DATASET / "metadata.jsonl").write_text(
        "\n".join(json.dumps(r, ensure_ascii=False) for r in rows), encoding="utf-8")

    # ten best reference clips: clean source, 3-9s, longest texts
    best = sorted([r for r in rows if r["clean"] and 3 <= r["duration"] <= 9],
                  key=lambda r: -len(r["text"]))[:10]
    for i, r in enumerate(best):
        subprocess.run(["cmd", "/c", "copy", "/y", str(DATASET / r["audio"]).replace("/", "\\"),
                        str(DATASET / "refs" / f"ref{i:02d}.wav").replace("/", "\\")],
                       check=False, capture_output=True)

    minutes = sum(r["duration"] for r in rows) / 60
    print(f"{stats['total']} clips ({minutes:.1f} min), {stats['vocals']} from vocal-isolated audio")
    print(f"dataset -> {DATASET}")


if __name__ == "__main__":
    main()

"""Identify unenrolled characters by dialogue context, not voice.

When a known character uses a name/relationship term, the person in the
adjacent turn is almost certainly that character. E.g. Guren says "Dad!" ->
the neighbouring unknown speaker is Guren's dad; Toxsa says "Wakame"/"sis" ->
the reply is Wakame. Since these bit-parts are enrolled nowhere, this beats
voice matching.

Runs on the named transcripts (data/transcripts/epNN.json) after
name_transcripts.py. Prints candidates as ready-to-run enroll commands; nothing
is enrolled automatically — you confirm with one listen.

Usage: python find_by_context.py
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "transcripts"

# (cue words, who says it, the character being addressed)
CUES = [
    (["dad", "father", "pop"], "Guren", "Guren's Dad"),
    (["wakame", "sis", "sister"], "Toxsa", "Wakame"),
    (["mr. white", "mister white"], None, "Mr. White"),
]
WINDOW = 2  # turns on either side to look for the addressed speaker


def spk_id(label: str) -> str | None:
    m = re.search(r"SPEAKER_\d+", label)
    return m.group(0) if m else None


def main() -> None:
    found: dict[tuple[int, str, str], int] = {}
    for f in sorted(OUT.glob("ep*.json")):
        ep = int(f.stem[2:4])
        lines = json.loads(f.read_text(encoding="utf-8"))["lines"]
        for i, ln in enumerate(lines):
            low = ln["text"].lower()
            for cues, sayer, target in CUES:
                if sayer and ln["speaker"] != sayer:
                    continue
                if not any(re.search(r"\b" + re.escape(c) + r"\b", low) for c in cues):
                    continue
                # the addressed character is a nearby *unknown* speaker
                for j in range(max(0, i - WINDOW), min(len(lines), i + WINDOW + 1)):
                    if j == i:
                        continue
                    sid = spk_id(lines[j]["speaker"])
                    if sid and "UNKNOWN" in lines[j]["speaker"]:
                        found[(ep, sid, target)] = found.get((ep, sid, target), 0) + 1

    if not found:
        print("No context candidates (run after name_transcripts.py, or names already resolved).")
        return
    print("Context candidates (confirm with one listen, then run the enroll line):\n")
    by_ep: dict[int, list[tuple[str, str, int]]] = {}
    for (ep, sid, target), n in found.items():
        by_ep.setdefault(ep, []).append((sid, target, n))
    for ep in sorted(by_ep):
        for sid, target, n in sorted(by_ep[ep], key=lambda x: -x[2]):
            print(f"  ep{ep:02d}: {sid} is likely **{target}** ({n} contextual cue(s))")
            print(f"    clip: review_spk/ep{ep:02d}/{sid}_sample0.wav")
            print(f"    enroll: .venv\\Scripts\\python.exe enroll.py --episode {ep} {sid}=\"{target}\"\n")


if __name__ == "__main__":
    main()

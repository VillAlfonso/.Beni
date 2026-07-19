"""Import the user's hand-edits from data/transcripts/epNN.txt back into the
.json (the real source for ingest/subs), then LOCK the episode so no pipeline
rerun ever overwrites the corrections.

Timestamps are recovered by fuzzy-aligning each txt line to the original json
lines (deletions and small text edits survive; big rewrites get interpolated
times). Locked episodes are skipped by name_transcripts and export_readable.

Usage: python import_txt.py 50 51
"""
from __future__ import annotations

import difflib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "transcripts"

LINE = re.compile(r"^\[([a-z?\-]+)\]\s+([^:]{1,40}):\s?(.*)$")


def norm(s: str) -> str:
    return re.sub(r"\W+", " ", s.lower()).strip()


def import_ep(ep: int) -> None:
    jf = OUT / f"ep{ep:02d}.json"
    tf = OUT / f"ep{ep:02d}.txt"
    data = json.loads(jf.read_text(encoding="utf-8"))
    old = data["lines"]

    parsed = []
    for raw in tf.read_text(encoding="utf-8").splitlines():
        raw = raw.strip()
        if not raw:
            continue
        m = LINE.match(raw)
        if m:
            scene, spk, text = m.groups()
            parsed.append({"speaker": spk.strip(), "text": text.strip(), "scene": scene})
        elif parsed:
            parsed[-1]["text"] += " " + raw  # wrapped continuation line

    # fuzzy-align to recover timestamps, in order
    oi = 0
    new_lines = []
    for p in parsed:
        best, best_r = None, 0.0
        for j in range(oi, min(oi + 6, len(old))):
            r = difflib.SequenceMatcher(None, norm(p["text"]), norm(old[j]["text"])).ratio()
            if r > best_r:
                best, best_r = j, r
        if best is not None and best_r >= 0.55:
            src = old[best]
            oi = best + 1
        else:
            prev_t = new_lines[-1]["t1"] if new_lines else 0.0
            src = {"t0": prev_t + 0.1, "t1": prev_t + 2.5}
        entry = {"speaker": p["speaker"].replace("Unknown", "UNKNOWN(user)") if p["speaker"] == "Unknown" else p["speaker"],
                 "text": p["text"], "t0": src["t0"], "t1": src["t1"]}
        if p["scene"] and p["scene"] != "?":
            entry["scene"] = p["scene"]
        new_lines.append(entry)

    data["lines"] = new_lines
    data["locked"] = True
    data["locked_note"] = "user-corrected by hand; do not regenerate"
    jf.write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"ep{ep:02d}: imported {len(new_lines)} lines (was {len(old)}), LOCKED")


if __name__ == "__main__":
    for e in [int(x) for x in sys.argv[1:]]:
        import_ep(e)

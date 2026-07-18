"""Context-aware attribution repair using the LOCAL model (KoboldCpp :5001).

Voice diarization can't know that the person who fetched the shoes is the one
saying "one size almost fits all" — dialogue logic can. This pass slides a
window over each named transcript and asks the local model to fix ONLY:
  - speaker reassignments justified by conversational context
  - mid-sentence splits at turn boundaries (moves the dangling fragment)

Conservative by design: the model may only pick speakers already present in
the episode (or Unknown), edits are applied deterministically, and when the
model is unsure it must change nothing. Original files are backed up to
data/transcripts/pre_repair/ the first time.

Run AFTER labeling + name_transcripts, BEFORE ingest:
    python repair_attribution.py [--only 15]
Requires KoboldCpp running (start-model.bat). ~1-2 min per episode on GPU.
"""
from __future__ import annotations

import argparse
import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "transcripts"
BACKUP = OUT / "pre_repair"
API = "http://127.0.0.1:5001/v1/chat/completions"

WINDOW = 12
OVERLAP = 4

PROMPT = """You are fixing speaker attribution in a cartoon transcript (Tenkai Knights).
The voice-based labels are mostly right but make two kinds of mistakes:
1. A line assigned to the wrong character (dialogue logic reveals it: who is
   addressed, who is doing the action, first/second person, who just left).
2. A sentence torn across two lines at a speaker change (a dangling fragment).

Lines (index. [scene] speaker: text):
{lines}

Speakers you may use: {roster}.

Reply with ONLY a JSON array of corrections, [] if everything is fine. Ops:
  {{"i": <index>, "op": "speaker", "speaker": "<name>"}}   reassign line i
  {{"i": <index>, "op": "head_prev"}}   move line i's text before its first
      sentence end (. ! ? …) onto the end of line i-1 (fragment belongs above)
  {{"i": <index>, "op": "tail_next"}}   move line i's text after its last
      sentence end onto the start of line i+1 (fragment belongs below)
Only correct what the dialogue clearly justifies. When unsure, leave it. JSON only."""


def ask(lines_block: str, roster: list[str]) -> list[dict]:
    body = json.dumps({
        "model": "local",
        "messages": [{"role": "user", "content": PROMPT.format(lines=lines_block, roster=", ".join(roster))}],
        "temperature": 0.1,
        "max_tokens": 400,
    }).encode()
    req = urllib.request.Request(API, data=body, headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=180) as r:
        text = json.loads(r.read())["choices"][0]["message"]["content"]
    m = re.search(r"\[.*\]", text, re.S)
    if not m:
        return []
    try:
        ops = json.loads(m.group(0))
        return ops if isinstance(ops, list) else []
    except json.JSONDecodeError:
        return []


SENT_END = re.compile(r"[.!?…]")


def apply_ops(lines: list[dict], ops: list[dict], base: int, roster: set[str]) -> int:
    applied = 0
    for op in ops:
        try:
            i = base + int(op["i"])
            if not (0 <= i < len(lines)):
                continue
            kind = op.get("op")
            if kind == "speaker":
                spk = str(op.get("speaker", "")).strip()
                if spk in roster and lines[i]["speaker"] != spk:
                    lines[i]["speaker"] = spk
                    applied += 1
            elif kind == "head_prev" and i > 0:
                m = SENT_END.search(lines[i]["text"])
                if m:
                    frag, rest = lines[i]["text"][: m.end()], lines[i]["text"][m.end():].strip()
                    if rest:  # never empty a line completely
                        lines[i - 1]["text"] = (lines[i - 1]["text"] + " " + frag).strip()
                        lines[i]["text"] = rest
                        applied += 1
            elif kind == "tail_next" and i + 1 < len(lines):
                ends = list(SENT_END.finditer(lines[i]["text"]))
                if ends:
                    cut = ends[-1].end()
                    frag = lines[i]["text"][cut:].strip()
                    if frag:
                        lines[i]["text"] = lines[i]["text"][:cut].strip()
                        lines[i + 1]["text"] = (frag + " " + lines[i + 1]["text"]).strip()
                        applied += 1
        except (KeyError, ValueError, TypeError):
            continue
    return applied


def repair(ep: int) -> None:
    f = OUT / f"ep{ep:02d}.json"
    if not f.exists():
        return
    data = json.loads(f.read_text(encoding="utf-8"))
    lines = data["lines"]
    roster = sorted({l["speaker"] for l in lines if not l["speaker"].startswith("SPEAKER")} | {"Unknown"})

    BACKUP.mkdir(exist_ok=True)
    bak = BACKUP / f.name
    if not bak.exists():
        bak.write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")

    total = 0
    i = 0
    while i < len(lines):
        win = lines[i: i + WINDOW]
        block = "\n".join(
            f"{j}. [{l.get('scene', '?')}] {l['speaker']}: {l['text']}" for j, l in enumerate(win)
        )
        total += apply_ops(lines, ask(block, roster), i, set(roster))
        i += WINDOW - OVERLAP
    data["lines"] = [l for l in lines if l["text"].strip()]
    f.write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"ep{ep:02d}: {total} context corrections")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", type=int, default=None)
    a = ap.parse_args()
    try:
        urllib.request.urlopen("http://127.0.0.1:5001/v1/models", timeout=5)
    except Exception:
        raise SystemExit("KoboldCpp isn't running — start-model.bat first.")
    for f in sorted(OUT.glob("ep*.json")):
        ep = int(f.stem[2:4])
        if a.only and ep != a.only:
            continue
        repair(ep)
    print("done — rerun export_readable.py to see the fixed text, then npm run ingest")


if __name__ == "__main__":
    main()

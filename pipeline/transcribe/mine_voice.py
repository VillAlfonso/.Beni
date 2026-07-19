"""Mine content-verified voice clips for a character whose clusters keep
blending with others (Chooki problem): find lines that are theirs by DIALOGUE
LOGIC — replies right after their name is called, their transformation calls —
cut those exact clips, and build a yes/no page. Confirmed clips then become a
clean profile via enroll_clips.py.

Usage: python mine_voice.py Chooki --eps 8 17 21 33
Then open review_mine/Chooki/confirm.html
"""
from __future__ import annotations

import argparse
import html
import json
import re
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
OUT = ROOT / "data" / "transcripts"
EPISODES = ROOT / "data" / "episodes"
MINE = HERE / "review_mine"
FFMPEG = "C:/ffmpeg/ffmpeg"

# Quarton alter-egos: a transformation call is spoken by the character themself
ALTER = {"Chooki": "Lydendor", "Guren": "Bravenwolf", "Ceylan": "Tributon",
         "Toxsa": "Valorn", "Beni": "Venetta", "Gen": "Dromus"}
MEDIA_EXT = (".mp4", ".mkv", ".avi", ".webm")


def media_for(ep: int) -> Path | None:
    for ext in MEDIA_EXT:
        p = EPISODES / f"ep{ep}{ext}"
        if p.exists():
            return p
    return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("name")
    ap.add_argument("--eps", type=int, nargs="+", required=True)
    ap.add_argument("--max", type=int, default=14)
    a = ap.parse_args()
    alter = ALTER.get(a.name, "")
    name_re = re.compile(r"\b" + re.escape(a.name) + r"\b[,.!?]?", re.I)
    alter_re = re.compile(r"\b" + re.escape(alter) + r"\b.{0,30}(titan|mode|activate|tenkai)", re.I) if alter else None

    cands: list[dict] = []
    for ep in a.eps:
        f = OUT / f"ep{ep:02d}.json"
        if not f.exists():
            continue
        lines = json.loads(f.read_text(encoding="utf-8"))["lines"]
        for i, ln in enumerate(lines):
            dur = ln["t1"] - ln["t0"]
            if not (1.5 <= dur <= 9):
                continue
            reason = None
            prev = lines[i - 1] if i > 0 else None
            if prev and name_re.search(prev["text"]) and not name_re.search(ln["text"]):
                reason = f'reply after "{a.name}" was addressed'
            elif alter_re and alter_re.search(ln["text"]):
                reason = f"{alter} transformation call (spoken by {a.name})"
            if reason:
                cands.append({"ep": ep, "t0": ln["t0"], "t1": ln["t1"], "text": ln["text"], "reason": reason})
    cands = cands[: a.max]
    if not cands:
        print("no candidates found — widen --eps")
        return

    dest = MINE / a.name
    dest.mkdir(parents=True, exist_ok=True)
    cards = []
    for i, c in enumerate(cands):
        media = media_for(c["ep"])
        if not media:
            continue
        wav = dest / f"clip{i:02d}.wav"
        subprocess.run([FFMPEG, "-y", "-v", "error", "-ss", f"{max(0, c['t0'] - 0.15):.2f}",
                        "-i", str(media), "-t", f"{c['t1'] - c['t0'] + 0.3:.2f}",
                        "-ac", "1", "-ar", "16000", str(wav)], check=False)
        cards.append(f"""
  <div class=card data-i="{i}">
    <audio controls preload=none src="clip{i:02d}.wav"></audio>
    <div class=t>ep{c['ep']} · {html.escape(c['reason'])}</div>
    <div class=q>“{html.escape(c['text'][:110])}”</div>
    <label><input type=checkbox class=yes> yes, that's {a.name}</label>
  </div>""")

    page = f"""<!doctype html><meta charset=utf-8><title>Is this {a.name}?</title>
<style>body{{font-family:system-ui;background:#111;color:#eee;max-width:680px;margin:0 auto;padding:20px}}
.card{{background:#1c1c1c;border:1px solid #333;border-radius:10px;padding:12px;margin:10px 0}}
.t{{color:#8a8;font-size:12px;margin:6px 0 2px}}.q{{color:#bbb;font-size:13px;font-style:italic;margin-bottom:6px}}
audio{{width:100%;height:34px}}label{{font-size:13px;cursor:pointer}}
#bar{{position:sticky;bottom:0;background:#000;border-top:1px solid #333;padding:12px}}
#cmd{{width:100%;font-family:monospace;font-size:12px;background:#111;color:#6f6;border:1px solid #333;padding:8px;box-sizing:border-box}}</style>
<h2>Tick every clip that is definitely {a.name} — skip anything mixed or unsure</h2>
{''.join(cards)}
<div id=bar><textarea id=cmd readonly></textarea></div>
<script>
function r(){{const p=[...document.querySelectorAll('.card')].filter(c=>c.querySelector('.yes').checked).map(c=>c.dataset.i);
document.getElementById('cmd').value=p.length?'pipeline\\\\transcribe\\\\.venv\\\\Scripts\\\\python.exe pipeline\\\\transcribe\\\\enroll_clips.py {a.name} '+p.join(','):'(tick at least one)';}}
document.querySelectorAll('.yes').forEach(c=>c.addEventListener('change',r));r();
</script>"""
    (dest / "confirm.html").write_text(page, encoding="utf-8")
    print(f"{len(cards)} candidate clips -> {dest / 'confirm.html'}")


if __name__ == "__main__":
    main()

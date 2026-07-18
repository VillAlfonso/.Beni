"""Build a friendly HTML labeling page per episode.

For each speaker cluster: playable audio + the lines they spoke + a name box.
As you type names, the page writes the exact `enroll.py` command for you to copy.
No cryptic filenames, no hand-typed cluster ids.

Usage: python make_label_sheet.py            # every episode that has clips
       python make_label_sheet.py --only 14
Then open review/epNN/label.html in your browser.
"""
from __future__ import annotations

import argparse
import html
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
WORK = HERE / "work"
REVIEW = HERE / "review"
REVIEW_SPK = HERE / "review_spk"

# characters likely present, offered as one-click buttons (you can also free-type)
ROSTER = ["Beni", "Guren", "Ceylan", "Toxsa", "Chooki", "Gen", "Kiiro", "Mr. White",
          "Vilius", "Boreas", "Granox", "Slyger", "Wakame", "Guren's Dad",
          "Narrator", "ViliusGoon", "Other"]


def build(ep: int) -> bool:
    # prefer the accurate pyannote speakers (review_spk + aligned.json)
    rev = REVIEW_SPK / f"ep{ep:02d}"
    aligned = WORK / f"ep{ep:02d}.aligned.json"
    if not rev.exists():
        rev = REVIEW / f"ep{ep:02d}"
        aligned = None
    if not rev.exists():
        return False
    wavs = sorted(p.name for p in rev.glob("*_sample*.wav"))
    if not wavs:
        return False

    clusters: dict[str, list[str]] = {}
    for w in wavs:
        c = w.split("_sample")[0]
        clusters.setdefault(c, []).append(w)

    # show a few of each speaker's actual lines to help identify them
    text_by_cluster: dict[str, list[str]] = {}
    if aligned and aligned.exists():
        for ln in json.loads(aligned.read_text(encoding="utf-8"))["lines"]:
            text_by_cluster.setdefault(ln["speaker"], []).append(ln["text"])
    else:
        seg_file = WORK / f"ep{ep:02d}.segments.json"
        if seg_file.exists():
            for s in json.loads(seg_file.read_text(encoding="utf-8"))["segments"]:
                c = s.get("cluster")
                if c:
                    text_by_cluster.setdefault(c, []).append(s["text"])

    # most-talkative speakers first — main cast rises above bit parts
    order = sorted(clusters, key=lambda c: -len(text_by_cluster.get(c, clusters[c])))

    cards = []
    for c in order:
        lines = text_by_cluster.get(c, [])
        meta = f"{len(lines)} lines" if lines else f"{len(clusters[c])} clip(s)"
        players = "".join(
            f'<div class="clip"><audio controls preload="none" src="{w}"></audio></div>'
            for w in sorted(clusters[c])
        )
        # a few of the longer things this speaker said, to identify them by content
        examples = sorted((l for l in lines if len(l) > 12), key=len, reverse=True)[:4]
        said = "".join(f'<div class="said">“{html.escape(e[:90])}”</div>' for e in examples)
        cards.append(f"""
    <div class="card" data-cluster="{c}">
      <div class="head"><b>{c}</b><span class="meta">{meta}</span></div>
      {players}
      {said}
      <input class="name" placeholder="who is this? (type or click below)" autocomplete="off">
      <div class="chips">{''.join(f'<button class="chip">{r}</button>' for r in ROSTER)}</div>
    </div>""")
    order_len = len(order)

    page = f"""<!doctype html><meta charset=utf-8>
<title>Label voices · episode {ep}</title>
<style>
 body{{font-family:system-ui,sans-serif;max-width:760px;margin:0 auto;padding:20px;background:#111;color:#eee}}
 h1{{font-size:20px}} .sub{{color:#999;margin-bottom:20px}}
 .card{{background:#1c1c1c;border:1px solid #333;border-radius:10px;padding:14px;margin:12px 0}}
 .head{{display:flex;justify-content:space-between;margin-bottom:8px}} .meta{{color:#888;font-size:13px}}
 .clip{{display:flex;align-items:center;gap:10px;margin:6px 0}} audio{{height:32px}}
 .said{{color:#bbb;font-size:13px;font-style:italic}}
 .name{{width:100%;margin-top:8px;padding:8px;background:#111;border:1px solid #444;color:#fff;border-radius:6px;font-size:15px}}
 .name.done{{border-color:#4a4}}
 .chips{{margin-top:6px}} .chip{{background:#2a2a2a;border:1px solid #444;color:#ccc;border-radius:20px;padding:3px 10px;margin:3px 2px 0 0;cursor:pointer;font-size:12px}}
 .chip:hover{{background:#3a3a3a}}
 #bar{{position:sticky;bottom:0;background:#000;border-top:1px solid #333;padding:12px;margin-top:20px}}
 #cmd{{width:100%;font-family:monospace;font-size:12px;background:#111;color:#6f6;border:1px solid #333;border-radius:6px;padding:8px;box-sizing:border-box;min-height:44px}}
 #copy{{margin-top:8px;background:#2a5;border:none;color:#fff;padding:8px 16px;border-radius:6px;cursor:pointer}}
 .hint{{color:#777;font-size:12px;margin-top:6px}}
</style>
<h1>Episode {ep} — who's who?</h1>
<div class=sub>Play a clip, read what they said, name the voice. Same person in two cards? Give both the same name. Skip any you're unsure of. Then copy the command at the bottom and run it.</div>
{''.join(cards)}
<div id=bar>
  <textarea id=cmd readonly></textarea>
  <button id=copy>Copy command</button>
  <div class=hint>Paste it into your terminal at C:\\.Beni (or prefix with <b>!</b> here in Claude Code).</div>
</div>
<script>
const EP={ep};
function refresh(){{
  const parts=[];
  document.querySelectorAll('.card').forEach(c=>{{
    const n=c.querySelector('.name').value.trim().replace(/\\s+/g,'_');
    c.querySelector('.name').classList.toggle('done', !!n);
    if(n) parts.push(c.dataset.cluster+'='+n);
  }});
  document.getElementById('cmd').value = parts.length
    ? 'pipeline\\\\transcribe\\\\.venv\\\\Scripts\\\\python.exe pipeline\\\\transcribe\\\\enroll.py --episode '+EP+' '+parts.join(' ')
    : '(name at least one voice above)';
}}
document.querySelectorAll('.name').forEach(i=>i.addEventListener('input',refresh));
document.querySelectorAll('.chip').forEach(b=>b.addEventListener('click',()=>{{
  const inp=b.closest('.card').querySelector('.name'); inp.value=b.textContent; refresh();
}}));
document.getElementById('copy').onclick=()=>{{
  navigator.clipboard.writeText(document.getElementById('cmd').value);
  document.getElementById('copy').textContent='Copied ✓';
  setTimeout(()=>document.getElementById('copy').textContent='Copy command',1500);
}};
refresh();
</script>"""
    (rev / "label.html").write_text(page, encoding="utf-8")
    print(f"ep{ep:02d}: {order_len} voices -> {(rev / 'label.html')}")
    return True


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", type=int, default=None)
    a = ap.parse_args()
    built = 0
    for f in sorted(WORK.glob("ep*.segments.json")):
        ep = int(f.stem[2:4])
        if a.only and ep != a.only:
            continue
        if build(ep):
            built += 1
    print(f"{built} label sheet(s) ready.")


if __name__ == "__main__":
    main()

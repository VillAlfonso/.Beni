"""Write human-readable .txt transcripts next to the .json ones, + coverage stats.

data/transcripts/epNN.txt looks like:
    [earth] Beni: Did you miss me?
    [quarton-battle] Guren: Bravenwolf, Tenkai Firestorm!

Rerun anytime (after more labeling, it refreshes). Usage: python export_readable.py
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "transcripts"


def main() -> None:
    per_char: dict[str, int] = {}
    total = named = 0
    for f in sorted(OUT.glob("ep*.json")):
        data = json.loads(f.read_text(encoding="utf-8"))
        lines = data["lines"]
        if data.get("locked"):
            # user-corrected episode: never overwrite their .txt; count stats only
            for ln in lines:
                total += 1
                spk = ln["speaker"]
                if not spk.startswith("UNKNOWN") and not spk.startswith("SPEAKER"):
                    named += 1
                    per_char[spk] = per_char.get(spk, 0) + 1
            continue
        txt = []
        for ln in lines:
            spk = ln["speaker"]
            clean = "Unknown" if spk.startswith("UNKNOWN") else spk
            txt.append(f"[{ln.get('scene', '?')}] {clean}: {ln['text']}")
            total += 1
            if not spk.startswith("UNKNOWN") and not spk.startswith("SPEAKER"):
                named += 1
                per_char[spk] = per_char.get(spk, 0) + 1
        f.with_suffix(".txt").write_text("\n".join(txt), encoding="utf-8")
    print(f"{total} lines across {len(list(OUT.glob('ep*.json')))} episodes; "
          f"{named} named ({100 * named / max(total, 1):.0f}%)")
    for c, n in sorted(per_char.items(), key=lambda x: -x[1]):
        print(f"  {c}: {n} lines")


if __name__ == "__main__":
    main()

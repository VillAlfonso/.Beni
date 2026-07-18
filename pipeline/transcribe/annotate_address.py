"""Deterministic monologue/addressee annotator.

Adds to every line of data/transcripts/epNN.json:
    "mode":      "dialogue" | "monologue"
    "addressee": "Gen" | "group" | "self" | null   (who the line is spoken TO)

Signals (all auditable, no LLM):
  - vocative: another cast member's name in the line -> dialogue, addressed to them
  - self-address: speaker's own name ("Beni, Beni, Beni...") -> monologue to self
  - group words (everyone, guys, boys, knights) or 2+ names -> dialogue to group
  - second person (you/your) -> dialogue; addressee = nearest other speaker in time
  - time isolation: no OTHER speaker within +-ISOLATION_S -> monologue
    (catches "He's clueless..." delivered while Guren runs off)
  - otherwise: dialogue with the nearest other speaker in time

Usage: python annotate_address.py [--only 15]     (rerun-safe)
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "transcripts"

CAST = ["Beni", "Guren", "Ceylan", "Toxsa", "Chooki", "Gen", "Kiiro", "Vilius",
        "Mr. White", "Boreas", "Granox", "Slyger", "Wakame", "Dromus", "Venetta",
        "Bravenwolf", "Tributon", "Valorn", "Lydendor"]
# Quarton names map back to who they are
ALIAS = {"Venetta": "Beni", "Dromus": "Gen", "Bravenwolf": "Guren",
         "Tributon": "Ceylan", "Valorn": "Toxsa", "Lydendor": "Chooki"}
GROUP = re.compile(r"\b(everyone|everybody|guys|boys|knights|you (all|two|three|four))\b", re.I)
YOU = re.compile(r"\b(you|your|you're|ya)\b", re.I)
ISOLATION_S = 6.0
NEAR_S = 5.0


def names_in(text: str, exclude: str) -> list[str]:
    hits = []
    for c in CAST:
        who = ALIAS.get(c, c)
        if who == exclude:
            continue
        if re.search(r"\b" + re.escape(c) + r"\b", text, re.I):
            if who not in hits:
                hits.append(who)
    return hits


def annotate(lines: list[dict]) -> dict[str, int]:
    stats = {"monologue": 0, "dialogue": 0}
    for i, ln in enumerate(lines):
        spk, text = ln["speaker"], ln["text"]
        me = spk if not spk.startswith(("UNKNOWN", "SPEAKER")) else ""

        # nearest other-speaker lines in time (either direction)
        def other(idxs):
            for j in idxs:
                o = lines[j]
                if o["speaker"] != spk:
                    gap = max(ln["t0"] - o["t1"], o["t0"] - ln["t1"], 0)
                    return o, gap
            return None, 1e9

        prev, pgap = other(range(i - 1, max(-1, i - 4), -1))
        nxt, ngap = other(range(i + 1, min(len(lines), i + 4)))

        mode, addr = "dialogue", None
        self_call = me and len(re.findall(r"\b" + re.escape(me) + r"\b", text, re.I)) >= 2
        hits = names_in(text, me)

        if self_call:
            mode, addr = "monologue", "self"
        elif GROUP.search(text) or len(hits) >= 2:
            addr = "group"
        elif hits:
            addr = hits[0]
        elif YOU.search(text):
            near = prev if pgap <= ngap else nxt
            addr = near["speaker"] if near and not near["speaker"].startswith(("UNKNOWN", "SPEAKER")) else None
        elif pgap > ISOLATION_S and ngap > ISOLATION_S:
            mode, addr = "monologue", "self"
        else:
            near, gap = (prev, pgap) if pgap <= ngap else (nxt, ngap)
            if near and gap <= NEAR_S:
                addr = near["speaker"] if not near["speaker"].startswith(("UNKNOWN", "SPEAKER")) else None
            else:
                mode, addr = "monologue", "self"

        ln["mode"] = mode
        ln["addressee"] = addr
        stats[mode] += 1
    return stats


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", type=int, default=None)
    a = ap.parse_args()
    for f in sorted(OUT.glob("ep*.json")):
        ep = int(f.stem[2:4])
        if a.only and ep != a.only:
            continue
        data = json.loads(f.read_text(encoding="utf-8"))
        stats = annotate(data["lines"])
        f.write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")
        print(f"ep{ep:02d}: {stats['dialogue']} dialogue, {stats['monologue']} monologue")


if __name__ == "__main__":
    main()

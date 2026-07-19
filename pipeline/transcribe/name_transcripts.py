"""Phase B: turn SPEAKER_00… into real names, write final transcripts.

Needs voices/enrolled.npz (from enroll.py on labeled speakers). For every
work/epNN.aligned.json + epNN.spk_emb.npz:
  - match each pyannote speaker to the nearest enrolled voice (cosine)
  - relabel the lines, scene-tag them, write data/transcripts/epNN.json

Episodes 49–52 use voices/enrolled_jp.npz (different voice actors).

Usage: python name_transcripts.py [--only 14]
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

import scene_tag

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
WORK = HERE / "work"
OUT = ROOT / "data" / "transcripts"
JP_EPS: set[int] = set()  # empty since the EN dub of 49-52 arrived (2026-07-19)
MATCH_THRESHOLD = 0.60  # strict: a wrong name poisons context; Unknown is honest
                        # (0.45 let Corekai soldiers/boys match "Guren")

# The source's file numbering shifts +1 from file 40 (verified by content markers
# twice, incl. the user's re-downloaded set): files 40-52 contain dub eps 39-51.
# File 39 is extra dub-38-zone content (split or recap) — quarantined until the
# user confirms by eye what it is.
QUARANTINED_FILES = {39}


def dub_episode(file_ep: int) -> int:
    return file_ep - 1 if file_ep >= 40 else file_ep


def voices_path(ep: int) -> Path:
    return HERE / "voices" / ("enrolled_jp.npz" if ep in JP_EPS else "enrolled.npz")


def name_episode(ep: int) -> None:
    aligned = WORK / f"ep{ep:02d}.aligned.json"
    spk_file = WORK / f"ep{ep:02d}.spk_emb.npz"
    voices = voices_path(ep)
    if not (aligned.exists() and spk_file.exists()):
        print(f"ep{ep:02d}: no aligned data, skip")
        return
    if not voices.exists():
        print(f"ep{ep:02d}: no enrollment ({voices.name}) — label some speakers first")
        return

    enrolled = np.load(voices)
    spk_emb = np.load(spk_file)
    dim = spk_emb[spk_emb.files[0]].shape[0] if spk_emb.files else 0
    # only compare against profiles of the same embedding space (guards against a
    # stale ECAPA enrolled.npz vs pyannote 256-d embeddings)
    names = [n for n in enrolled.files if enrolled[n].shape[0] == dim]
    if not names:
        print(f"ep{ep:02d}: enrolled profiles don't match embedding dim {dim} — re-enroll")
        return

    label: dict[str, str] = {}
    for spk in spk_emb.files:
        v = spk_emb[spk]
        scores = {n: float(np.dot(v, enrolled[n])) for n in names}
        best = max(scores, key=lambda n: scores[n])
        label[spk] = best if scores[best] >= MATCH_THRESHOLD else f"UNKNOWN({spk})"

    data = json.loads(aligned.read_text(encoding="utf-8"))
    for ln in data["lines"]:
        ln["speaker"] = label.get(ln["speaker"], ln["speaker"])
    scene_tag.tag(data["lines"])

    # filenames keep the FILE number (matches the media); the episode field
    # carries the true DUB number — everything downstream (ingest, caps) uses it
    data["episode"] = dub_episode(ep)
    data["file_episode"] = ep

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"ep{ep:02d}.json").write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")
    named = sorted(set(v for v in label.values() if not v.startswith("UNKNOWN")))
    print(f"ep{ep:02d}: {', '.join(named) or 'no matches'}"
          + (f"  [unmatched: {sum(1 for v in label.values() if v.startswith('UNKNOWN'))}]"
             if any(v.startswith("UNKNOWN") for v in label.values()) else ""))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", type=int, default=None)
    a = ap.parse_args()
    for f in sorted(WORK.glob("ep*.aligned.json")):
        ep = int(f.stem[2:4])
        if a.only and ep != a.only:
            continue
        if ep in QUARANTINED_FILES:
            print(f"ep{ep:02d}: quarantined (dub-38-zone duplicate) — not written to transcripts")
            continue
        name_episode(ep)


if __name__ == "__main__":
    main()

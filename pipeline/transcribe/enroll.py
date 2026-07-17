"""One-time voice enrollment.

After diarize_match.py exported review clips for an episode, listen to them
in Explorer and tell this script which cluster is which character:

    python enroll.py --episode 14 SPEAKER_00=Beni SPEAKER_01=Guren SPEAKER_02=Ceylan

Labels accumulate into voices/enrolled.npz (existing profiles are averaged
with new ones, so enrolling from 2-3 episodes makes matching sturdier).
Then rerun diarize_match.py — every episode auto-labels from here on.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
WORK = HERE / "work"
VOICES = HERE / "voices" / "enrolled.npz"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--episode", type=int, required=True)
    ap.add_argument("labels", nargs="+", help="CLUSTER=CharacterName …")
    args = ap.parse_args()

    clusters_file = WORK / f"ep{args.episode:02d}.clusters.npz"
    if not clusters_file.exists():
        raise SystemExit(f"{clusters_file} not found — run diarize_match.py first.")
    clusters = np.load(clusters_file)

    existing: dict[str, np.ndarray] = {}
    if VOICES.exists():
        old = np.load(VOICES)
        existing = {n: old[n] for n in old.files}

    for pair in args.labels:
        if "=" not in pair:
            raise SystemExit(f"bad label {pair!r}, expected CLUSTER=Name")
        cluster, name = pair.split("=", 1)
        if cluster not in clusters.files:
            raise SystemExit(f"cluster {cluster!r} not in {clusters_file.name} (has: {clusters.files})")
        vec = clusters[cluster]
        if name in existing:
            merged = (existing[name] + vec) / 2
            existing[name] = merged / (np.linalg.norm(merged) + 1e-9)
            print(f"updated profile: {name}")
        else:
            existing[name] = vec
            print(f"new profile: {name}")

    VOICES.parent.mkdir(parents=True, exist_ok=True)
    np.savez(VOICES, **existing)
    print(f"saved {len(existing)} voice profiles → {VOICES}")
    print("rerun diarize_match.py to auto-label all episodes.")


if __name__ == "__main__":
    main()

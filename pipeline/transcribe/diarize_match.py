"""Step 2: who said what.

For each work/epNN.segments.json + work/epNN.wav:
  1. pyannote diarization splits the audio into speaker clusters
  2. each Whisper/subtitle segment gets the cluster it overlaps most
  3. clusters are embedded (ECAPA) and matched against voices/enrolled.npz
  4. matched episodes are written straight to data/transcripts/epNN.json

If no enrollment exists yet (first run), sample clips per cluster are exported
to review/epNN/ — listen to them, then label once with enroll.py. After that,
every episode auto-labels.

Usage:
    set HF_TOKEN=hf_xxx   (once; free token, accept pyannote model terms)
    python diarize_match.py            # all pending episodes
    python diarize_match.py --only 14
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import numpy as np
import soundfile as sf

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
WORK = HERE / "work"
REVIEW = HERE / "review"
VOICES = HERE / "voices" / "enrolled.npz"
OUT = ROOT / "data" / "transcripts"

MATCH_THRESHOLD = 0.55


def diarize(wav: Path):
    from pyannote.audio import Pipeline

    token = os.environ.get("HF_TOKEN")
    if not token:
        raise SystemExit("Set HF_TOKEN (free) — see requirements.txt header.")
    pipe = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1", use_auth_token=token)
    try:
        import torch

        if torch.cuda.is_available():
            pipe.to(torch.device("cuda"))
    except Exception:
        pass
    dia = pipe(str(wav))
    return [(turn.start, turn.end, speaker) for turn, _, speaker in dia.itertracks(yield_label=True)]


_embedder = None


def embed_clip(wav_data: np.ndarray, sr: int) -> np.ndarray:
    global _embedder
    import torch
    from speechbrain.inference.speaker import EncoderClassifier

    if _embedder is None:
        _embedder = EncoderClassifier.from_hparams(
            source="speechbrain/spkrec-ecapa-voxceleb",
            run_opts={"device": "cuda" if torch.cuda.is_available() else "cpu"},
        )
    sig = torch.from_numpy(wav_data).float().unsqueeze(0)
    emb = _embedder.encode_batch(sig).squeeze().detach().cpu().numpy()
    return emb / (np.linalg.norm(emb) + 1e-9)


def overlap(a0: float, a1: float, b0: float, b1: float) -> float:
    return max(0.0, min(a1, b1) - max(a0, b0))


def process(ep: int) -> None:
    seg_file = WORK / f"ep{ep:02d}.segments.json"
    wav_file = WORK / f"ep{ep:02d}.wav"
    data = json.loads(seg_file.read_text(encoding="utf-8"))
    segments = data["segments"]

    print(f"ep{ep:02d}: diarizing…")
    turns = diarize(wav_file)
    audio, sr = sf.read(wav_file)

    # per-segment cluster by max overlap
    for s in segments:
        best, best_ov = None, 0.0
        for t0, t1, spk in turns:
            ov = overlap(s["start"], s["end"], t0, t1)
            if ov > best_ov:
                best, best_ov = spk, ov
        s["cluster"] = best or "UNKNOWN"

    # cluster embeddings from their longest segments
    clusters: dict[str, list[dict]] = {}
    for s in segments:
        clusters.setdefault(s["cluster"], []).append(s)
    cluster_emb: dict[str, np.ndarray] = {}
    for name, segs in clusters.items():
        segs_sorted = sorted(segs, key=lambda s: s["end"] - s["start"], reverse=True)[:5]
        embs = []
        for s in segs_sorted:
            clip = audio[int(s["start"] * sr) : int(s["end"] * sr)]
            if len(clip) > sr:  # ≥1s
                embs.append(embed_clip(clip, sr))
        if embs:
            v = np.mean(embs, axis=0)
            cluster_emb[name] = v / (np.linalg.norm(v) + 1e-9)

    if VOICES.exists():
        enrolled = np.load(VOICES)
        names = list(enrolled.files)
        labeled: dict[str, str] = {}
        for cname, cvec in cluster_emb.items():
            scores = {n: float(np.dot(cvec, enrolled[n])) for n in names}
            best = max(scores, key=lambda n: scores[n])
            labeled[cname] = best if scores[best] >= MATCH_THRESHOLD else f"UNKNOWN({cname})"
            print(f"  {cname} → {labeled[cname]} ({scores[best]:.2f})")
        lines = [
            {"speaker": labeled.get(s["cluster"], "UNKNOWN"), "text": s["text"], "t0": round(s["start"], 2), "t1": round(s["end"], 2)}
            for s in segments
        ]
        OUT.mkdir(parents=True, exist_ok=True)
        out_file = OUT / f"ep{ep:02d}.json"
        out_file.write_text(json.dumps({"episode": ep, "lines": lines}, indent=1), encoding="utf-8")
        # keep cluster embeddings around so enroll.py can refine profiles later
        np.savez(WORK / f"ep{ep:02d}.clusters.npz", **cluster_emb)
        print(f"  wrote {out_file.relative_to(ROOT)} — run `npm run ingest` to index it")
    else:
        # first run: export samples for one-time labeling
        rev = REVIEW / f"ep{ep:02d}"
        rev.mkdir(parents=True, exist_ok=True)
        for cname, segs in clusters.items():
            segs_sorted = sorted(segs, key=lambda s: s["end"] - s["start"], reverse=True)[:3]
            for i, s in enumerate(segs_sorted):
                clip = audio[int(s["start"] * sr) : int(s["end"] * sr)]
                sf.write(rev / f"{cname}_sample{i}.wav", clip, sr)
        np.savez(WORK / f"ep{ep:02d}.clusters.npz", **cluster_emb)
        print(f"  no enrollment yet → listen to clips in {rev}")
        print(f"  then: python enroll.py --episode {ep} {list(clusters)[0]}=Beni …")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", type=int, default=None)
    args = ap.parse_args()
    pending = sorted(WORK.glob("ep*.segments.json"))
    if not pending:
        raise SystemExit("Run transcribe.py first.")
    for f in pending:
        ep = int(f.stem[2:4])
        if args.only and ep != args.only:
            continue
        process(ep)


if __name__ == "__main__":
    main()

"""Step 2: who said what.

For each work/epNN.segments.json + work/epNN.wav:
  1. speaker turns:
       - with HF_TOKEN set and pyannote installed → pyannote diarization (best)
       - otherwise (default, no token needed) → every Whisper segment ≥0.8s is
         embedded with ECAPA and greedily clustered by cosine similarity
  2. each segment gets a cluster; clusters are matched against enrolled voices
  3. matched episodes are written to data/transcripts/epNN.json

Enrollment lives in voices/enrolled.npz — except eps 49-52 (Japanese audio,
different voice actors), which use voices/enrolled_jp.npz. Same character
names in both; the label you type is what the transcript shows.

First run (no enrollment): sample clips per cluster are exported to
review/epNN/ — listen, then label once with enroll.py. Clusters that later
match below threshold also export clips so profiles can be refined.

Usage:
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
OUT = ROOT / "data" / "transcripts"

JP_EPS = set(range(49, 53))
MATCH_THRESHOLD = 0.55
CLUSTER_THRESHOLD = 0.50  # 0.60 over-split one voice into many clusters (ep14: 29)
MIN_CLIP_SECONDS = 0.8


def voices_file(ep: int) -> Path:
    return HERE / "voices" / ("enrolled_jp.npz" if ep in JP_EPS else "enrolled.npz")


def diarize_pyannote(wav: Path):
    from pyannote.audio import Pipeline

    token = os.environ["HF_TOKEN"]
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


def embed_clip(wav_data: np.ndarray) -> np.ndarray:
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


def cluster_by_embedding(segments: list[dict], audio: np.ndarray, sr: int) -> dict[str, np.ndarray]:
    """Token-free fallback: greedy cosine clustering of per-segment ECAPA embeddings.
    Sets s["cluster"] on every segment; returns final cluster centroids."""
    centroids: list[tuple[str, np.ndarray, int]] = []  # (name, vec, count)
    for s in segments:
        clip = audio[int(s["start"] * sr) : int(s["end"] * sr)]
        if len(clip) < sr * MIN_CLIP_SECONDS:
            s["cluster"] = None
            continue
        emb = embed_clip(clip)
        s["_emb"] = emb
        best_i, best_cos = -1, -1.0
        for i, (_, vec, _) in enumerate(centroids):
            cos = float(np.dot(emb, vec))
            if cos > best_cos:
                best_i, best_cos = i, cos
        if best_i >= 0 and best_cos >= CLUSTER_THRESHOLD:
            name, vec, n = centroids[best_i]
            merged = (vec * n + emb) / (n + 1)
            centroids[best_i] = (name, merged / (np.linalg.norm(merged) + 1e-9), n + 1)
            s["cluster"] = name
        else:
            name = f"S{len(centroids):02d}"
            centroids.append((name, emb, 1))
            s["cluster"] = name
    # short segments inherit the nearest labeled neighbor in time
    for i, s in enumerate(segments):
        if s["cluster"] is None:
            prev = next((segments[j]["cluster"] for j in range(i - 1, -1, -1) if segments[j]["cluster"]), None)
            nxt = next((segments[j]["cluster"] for j in range(i + 1, len(segments)) if segments[j]["cluster"]), None)
            s["cluster"] = prev or nxt or "UNKNOWN"
    return {name: vec for name, vec, _ in centroids}


def export_review_clips(ep: int, clusters: dict[str, list[dict]], audio: np.ndarray, sr: int, only: set[str] | None = None) -> None:
    rev = REVIEW / f"ep{ep:02d}"
    rev.mkdir(parents=True, exist_ok=True)
    for cname, segs in clusters.items():
        if only is not None and cname not in only:
            continue
        segs_sorted = sorted(segs, key=lambda s: s["end"] - s["start"], reverse=True)[:3]
        for i, s in enumerate(segs_sorted):
            clip = audio[int(s["start"] * sr) : int(s["end"] * sr)]
            sf.write(rev / f"{cname}_sample{i}.wav", clip, sr)


def process(ep: int) -> None:
    seg_file = WORK / f"ep{ep:02d}.segments.json"
    wav_file = WORK / f"ep{ep:02d}.wav"
    vocals = WORK / f"ep{ep:02d}.vocals.wav"
    if vocals.exists():
        wav_file = vocals  # isolated speech: coherent voice embeddings
    data = json.loads(seg_file.read_text(encoding="utf-8"))
    segments = data["segments"]
    audio, sr = sf.read(wav_file)

    use_pyannote = bool(os.environ.get("HF_TOKEN"))
    if use_pyannote:
        print(f"ep{ep:02d}: diarizing (pyannote)…")
        turns = diarize_pyannote(wav_file)
        for s in segments:
            best, best_ov = None, 0.0
            for t0, t1, spk in turns:
                ov = overlap(s["start"], s["end"], t0, t1)
                if ov > best_ov:
                    best, best_ov = spk, ov
            s["cluster"] = best or "UNKNOWN"
        clusters_of: dict[str, list[dict]] = {}
        for s in segments:
            clusters_of.setdefault(s["cluster"], []).append(s)
        cluster_emb: dict[str, np.ndarray] = {}
        for name, segs in clusters_of.items():
            segs_sorted = sorted(segs, key=lambda s: s["end"] - s["start"], reverse=True)[:5]
            embs = []
            for s in segs_sorted:
                clip = audio[int(s["start"] * sr) : int(s["end"] * sr)]
                if len(clip) > sr:
                    embs.append(embed_clip(clip))
            if embs:
                v = np.mean(embs, axis=0)
                cluster_emb[name] = v / (np.linalg.norm(v) + 1e-9)
    else:
        print(f"ep{ep:02d}: clustering by voice embedding (no HF token needed)…")
        cluster_emb = cluster_by_embedding(segments, audio, sr)
        clusters_of = {}
        for s in segments:
            clusters_of.setdefault(s["cluster"], []).append(s)

    for s in segments:
        s.pop("_emb", None)

    voices = voices_file(ep)
    np.savez(WORK / f"ep{ep:02d}.clusters.npz", **cluster_emb)

    if not voices.exists():
        export_review_clips(ep, clusters_of, audio, sr)
        lang = "JP-audio " if ep in JP_EPS else ""
        print(f"  no {lang}enrollment yet -> listen to clips in {REVIEW / f'ep{ep:02d}'}")
        print(f"  then: python enroll.py --episode {ep} " + " ".join(f"{c}=Name" for c in list(clusters_of)[:3]) + " …")
        return

    enrolled = np.load(voices)
    names = list(enrolled.files)
    labeled: dict[str, str] = {}
    unmatched: set[str] = set()
    for cname, cvec in cluster_emb.items():
        scores = {n: float(np.dot(cvec, enrolled[n])) for n in names}
        best = max(scores, key=lambda n: scores[n])
        if scores[best] >= MATCH_THRESHOLD:
            labeled[cname] = best
        else:
            labeled[cname] = f"UNKNOWN({cname})"
            unmatched.add(cname)
        print(f"  {cname} -> {labeled[cname]} ({scores[best]:.2f})")

    lines = [
        {"speaker": labeled.get(s["cluster"], "UNKNOWN"), "text": s["text"], "t0": round(s["start"], 2), "t1": round(s["end"], 2)}
        for s in segments
    ]
    OUT.mkdir(parents=True, exist_ok=True)
    out_file = OUT / f"ep{ep:02d}.json"
    out_file.write_text(json.dumps({"episode": ep, "lines": lines}, indent=1), encoding="utf-8")
    if unmatched:
        export_review_clips(ep, clusters_of, audio, sr, only=unmatched)
        print(f"  {len(unmatched)} unmatched cluster(s) → clips in {REVIEW / f'ep{ep:02d}'} (enroll to refine)")
    print(f"  wrote {out_file.relative_to(ROOT)}")


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

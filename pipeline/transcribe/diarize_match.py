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
CLUSTER_DIST = 0.72  # cosine-distance cut (validated on ep18: ~14 clusters)
CLUSTER_MIN_SECONDS = 2.0  # ECAPA embeddings on <2s anime clips are noise → cluster on long clips only
MIN_CLIP_SECONDS = 0.8  # min clip length still exported for review


def voices_file(ep: int) -> Path:
    return HERE / "voices" / ("enrolled_jp.npz" if ep in JP_EPS else "enrolled.npz")


def hf_token() -> str | None:
    tok = os.environ.get("HF_TOKEN")
    if tok:
        return tok.strip()
    f = HERE / "hf_token.txt"
    return f.read_text(encoding="utf-8").strip() if f.exists() else None


_pyannote_pipe = None

# pyannote pipelines to try, newest first; each needs its HF license accepted
PYANNOTE_MODELS = ["pyannote/speaker-diarization-community-1", "pyannote/speaker-diarization-3.1"]


def _apply_torchaudio_shims() -> None:
    """torch 2.11 (needed for the Blackwell GPU) removed the torchaudio backend
    APIs pyannote still probes. We feed waveforms directly, so these stubs are
    never actually exercised for decoding."""
    import types

    import torchaudio

    for n, f in [("list_audio_backends", lambda: ["soundfile"]),
                 ("get_audio_backend", lambda: "soundfile"),
                 ("set_audio_backend", lambda x=None: None)]:
        if not hasattr(torchaudio, n):
            setattr(torchaudio, n, f)
    if not hasattr(torchaudio, "io"):
        import sys

        io = types.ModuleType("torchaudio.io")

        class _Stub:
            def __init__(self, *a, **k):
                raise RuntimeError("torchaudio.io stub — pyannote should use in-memory waveforms")

        io.StreamReader = _Stub
        io.StreamWriter = _Stub
        torchaudio.io = io
        sys.modules["torchaudio.io"] = io


def diarize_pyannote(wav: Path):
    import torch

    _apply_torchaudio_shims()
    from pyannote.audio import Pipeline

    global _pyannote_pipe
    if _pyannote_pipe is None:
        token = hf_token()
        errors = []
        for model in PYANNOTE_MODELS:
            try:
                _pyannote_pipe = Pipeline.from_pretrained(model, token=token)
                break
            except TypeError:
                _pyannote_pipe = Pipeline.from_pretrained(model, use_auth_token=token)
                break
            except Exception as e:  # gated/403 or missing → try the next model
                errors.append(f"{model}: {str(e).splitlines()[-1][:120]}")
        if _pyannote_pipe is None:
            raise SystemExit("No pyannote pipeline could load. Accept the license for one of:\n  "
                             + "\n  ".join(PYANNOTE_MODELS) + "\nDetails:\n  " + "\n  ".join(errors))
        if torch.cuda.is_available():
            _pyannote_pipe.to(torch.device("cuda"))
    # feed a pre-loaded waveform (soundfile) so pyannote never invokes the
    # torchaudio/torchcodec decode path (its DLL fails to load on this box).
    data, sr = sf.read(str(wav))
    if data.ndim > 1:
        data = data.mean(axis=1)
    wf = torch.from_numpy(data).float().unsqueeze(0)  # (channel, time)
    dia = _pyannote_pipe({"waveform": wf, "sample_rate": sr})
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
    """Token-free speaker clustering of per-segment ECAPA embeddings.

    Agglomerative (average-linkage, cosine) over ALL segments at once, cut at a
    distance threshold. Order-independent — unlike online greedy clustering,
    which shattered single voices into 100+ clusters. Sets s["cluster"] on every
    segment; returns cluster centroids."""
    from collections import defaultdict

    idx: list[int] = []
    embs: list[np.ndarray] = []
    for i, s in enumerate(segments):
        clip = audio[int(s["start"] * sr) : int(s["end"] * sr)]
        if len(clip) < sr * CLUSTER_MIN_SECONDS:
            s["cluster"] = None
            continue
        idx.append(i)
        embs.append(embed_clip(clip))

    if not embs:
        for s in segments:
            s["cluster"] = "UNKNOWN"
        return {}

    X = np.vstack(embs)  # rows already L2-normalized
    if len(embs) == 1:
        labels = np.array([1])
    else:
        from scipy.cluster.hierarchy import fcluster, linkage
        from scipy.spatial.distance import pdist

        Z = linkage(pdist(X, metric="cosine"), method="average")
        labels = fcluster(Z, t=CLUSTER_DIST, criterion="distance")

    for j, i in enumerate(idx):
        segments[i]["cluster"] = f"S{int(labels[j]):02d}"

    # short segments inherit the nearest labeled neighbor in time
    for i, s in enumerate(segments):
        if s.get("cluster") is None:
            prev = next((segments[j]["cluster"] for j in range(i - 1, -1, -1) if segments[j].get("cluster")), None)
            nxt = next((segments[j]["cluster"] for j in range(i + 1, len(segments)) if segments[j].get("cluster")), None)
            s["cluster"] = prev or nxt or "UNKNOWN"

    groups: dict[str, list[np.ndarray]] = defaultdict(list)
    for j, i in enumerate(idx):
        groups[segments[i]["cluster"]].append(X[j])
    centroids: dict[str, np.ndarray] = {}
    for name, vecs in groups.items():
        v = np.mean(vecs, axis=0)
        centroids[name] = v / (np.linalg.norm(v) + 1e-9)
    return centroids


def export_review_clips(ep: int, clusters: dict[str, list[dict]], audio: np.ndarray, sr: int, only: set[str] | None = None) -> None:
    rev = REVIEW / f"ep{ep:02d}"
    rev.mkdir(parents=True, exist_ok=True)
    for cname, segs in clusters.items():
        if only is not None and cname not in only:
            continue
        # prefer segments near ~3.5s: long enough for a clean voiceprint, short
        # enough to usually be ONE speaker (the longest segments are the ones
        # most likely to contain two characters, so don't just take the max).
        ideal = 3.5
        picks = sorted(segs, key=lambda s: abs((s["end"] - s["start"]) - ideal))[:3]
        for i, s in enumerate(picks):
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

    use_pyannote = bool(hf_token())
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

    # persist cluster tags so the label sheet can show each voice's spoken lines
    seg_file.write_text(json.dumps({"episode": ep, "segments": segments}, indent=1), encoding="utf-8")

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

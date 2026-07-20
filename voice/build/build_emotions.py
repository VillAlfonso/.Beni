"""Cut Beni's emotion reference library from hand-marked timestamps.

The spans below were marked by watching the episode files directly, so they are
cut EXACTLY as given — no transcript is consulted for boundaries or for text.
Each clip's reference text is read back off the clip itself with Whisper, so it
always matches the audio that was actually selected.

Source is the demucs vocals track (background music removed) resampled to
24 kHz, which is what Qwen3-TTS requires and what clone quality depends on.

A speaker-similarity number is reported per clip for information only — it never
drops a clip. Ears decide, not cosine.

Usage: python build_emotions.py
Output: clips/emotions/<tag>.wav + voice/beni-emotions.json + out/emotions-report.txt
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import soundfile as sf

ADDON = Path(__file__).resolve().parent
ROOT = ADDON.parents[1]
WORK = ROOT / "pipeline" / "transcribe" / "work"
DATASET = ADDON / "dataset"
OUT = ADDON / "voice" / "emotions"

# (episode, start, end, tag, descriptor) — exactly as marked, in file order
SPANS = [
    (15, "0:59",  "1:02",  "laughing",     "laughing"),
    (15, "6:49",  "6:58",  "happy",        "happy and excited"),
    (15, "7:47",  "7:52",  "excited",      "happy and excited"),
    (15, "8:32",  "8:35",  "explaining",   "explaining something"),
    (15, "8:38",  "8:41",  "asking",       "requesting something personal"),
    (15, "11:05", "11:14", "teasing",      "teasing"),
    (15, "11:33", "11:38", "greeting",     "greeting someone from afar, enthusiastically"),
    (15, "11:41", "11:46", "enthusiastic", "enthusiastic and happy"),
    (15, "21:03", "21:09", "neutral",      "neutral"),
    (18, "0:45",  "0:48",  "neutral2",     "neutral"),
    (18, "0:55",  "1:02",  "neutral3",     "neutral"),
    (18, "5:58",  "6:05",  "belittling",   "belittling someone"),
    (18, "6:16",  "6:27",  "belittling2",  "belittling someone"),
    (18, "19:21", "19:26", "surprised",    "surprised"),
    (22, "12:44", "13:13", "sad",          "sad and melancholic"),
    (22, "16:46", "16:58", "warm",         "happy"),
    (41, "20:52", "20:58", "desperate",    "desperately negotiating"),
    (43, "1:24",  "1:28",  "angry",        "lecturing people angrily"),
    (43, "11:30", "11:36", "judging",      "judging someone"),
    (47, "12:54", "13:05", "touched",      "touched and appreciative"),
]


def sec(s: str) -> float:
    m, x = s.split(":")
    return int(m) * 60 + float(x)


def _shim_torchaudio() -> None:
    """speechbrain 1.x imports torchaudio APIs that newer torchaudio dropped.
    We only ever use the speaker encoder, so stub the streaming bits it merely
    references at import time."""
    import types

    import torchaudio

    if not hasattr(torchaudio, "list_audio_backends"):
        torchaudio.list_audio_backends = lambda: ["soundfile"]
    if not hasattr(torchaudio, "io"):
        io_mod = types.ModuleType("torchaudio.io")
        io_mod.StreamReader = object
        io_mod.StreamWriter = object
        torchaudio.io = io_mod
        import sys

        sys.modules["torchaudio.io"] = io_mod

    # speechbrain still passes the long-renamed use_auth_token kwarg
    import huggingface_hub

    if not getattr(huggingface_hub.hf_hub_download, "_beni_shim", False):
        _orig = huggingface_hub.hf_hub_download

        def _dl(*a, **kw):
            if "use_auth_token" in kw:
                kw["token"] = kw.pop("use_auth_token")
            return _orig(*a, **kw)

        _dl._beni_shim = True
        huggingface_hub.hf_hub_download = _dl


_emb = None


def embed(samples: np.ndarray, sr: int) -> np.ndarray:
    global _emb
    import torch

    _shim_torchaudio()
    from speechbrain.inference.speaker import EncoderClassifier

    if _emb is None:
        _emb = EncoderClassifier.from_hparams(
            source="speechbrain/spkrec-ecapa-voxceleb",
            run_opts={"device": "cuda" if torch.cuda.is_available() else "cpu"},
        )
    if sr != 16000:
        import scipy.signal as ss

        samples = ss.resample_poly(samples, 16000, sr)
    sig = torch.from_numpy(np.asarray(samples, dtype="float32")).unsqueeze(0)
    v = _emb.encode_batch(sig).squeeze().detach().cpu().numpy()
    return v / (np.linalg.norm(v) + 1e-9)


_asr = None


def transcribe(path: Path) -> str:
    """Read the words back off the clip itself — never from a stored transcript."""
    global _asr
    from faster_whisper import WhisperModel

    if _asr is None:
        import torch

        cuda = torch.cuda.is_available()
        _asr = WhisperModel("medium.en", device="cuda" if cuda else "cpu",
                            compute_type="float16" if cuda else "int8")
    segs, _ = _asr.transcribe(str(path), language="en", vad_filter=False, beam_size=5)
    return " ".join(s.text.strip() for s in segs).strip()


def beni_reference() -> np.ndarray | None:
    """Her curated clips, averaged — used only to print a similarity number.
    Purely informational: if the encoder won't load, the build still runs."""
    meta = DATASET / "metadata.jsonl"
    if not meta.exists():
        return None
    try:
        rows = [json.loads(l) for l in open(meta, encoding="utf-8")]
        good = [r for r in rows if r["clean"] and 3 <= r["duration"] <= 9][:24]
        vecs = []
        for r in good:
            s, sr = sf.read(DATASET / r["audio"])
            vecs.append(embed(s, sr))
        if not vecs:
            return None
        v = np.mean(vecs, axis=0)
        return v / np.linalg.norm(v)
    except Exception as err:
        print(f"  (speaker check unavailable: {str(err)[:70]} — cutting anyway)")
        return None


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    ref = beni_reference()

    library: dict[str, dict] = {}
    report: list[str] = []
    for ep, a, b, tag, descriptor in SPANS:
        voc = WORK / f"ep{ep:02d}.vocals24.wav"
        if not voc.exists():
            line = f"  SKIP  {tag:12s} ep{ep} {a}-{b}  (no music-free audio yet)"
            print(line)
            report.append(line)
            continue

        t0, t1 = sec(a), sec(b)
        s, sr = sf.read(voc, start=int(t0 * 24000), stop=int(t1 * 24000))
        if s.ndim > 1:
            s = s.mean(axis=1)
        dest = OUT / f"{tag}.wav"
        sf.write(dest, s, sr)

        text = transcribe(dest)
        sim = float(embed(s, sr) @ ref) if ref is not None else float("nan")
        line = f"  {tag:12s} ep{ep} {a}-{b}  {t1-t0:4.1f}s  voice-match {sim:.2f}  \"{text[:58]}\""
        print(line)
        report.append(line)

        library[tag] = {
            "audio": f"clips/emotions/{tag}.wav",
            "text": text or "(laughs)",
            "descriptor": descriptor,
            "source": f"ep{ep} {a}-{b}",
            "voice_match": round(sim, 3) if sim == sim else None,
        }

    (ADDON / "voice" / "beni-emotions.json").write_text(
        json.dumps(library, indent=2, ensure_ascii=False), encoding="utf-8")
    (ADDON / "out" / "emotions-report.txt").write_text("\n".join(report), encoding="utf-8")
    print(f"\n{len(library)} clips -> voice/beni-emotions.json")
    print("Listen in voice/clips/emotions/ — delete any that aren't her and rerun the wiring.")


if __name__ == "__main__":
    main()

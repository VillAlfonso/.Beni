"""Second batch of hand-marked emotion anchors — fills the gaps in the map.

Same rules as the first batch: cut exactly at the marked timestamps off the
demucs vocals track at 24 kHz, read the reference text back off the clip itself
with Whisper, never consult a stored transcript.

Adds to voice/beni-emotions.json rather than replacing it.

Run: python build_emotions2.py     (needs the transcribe venv for speechbrain)
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

# (episode, start, end, tag, descriptor)
# NOTE: the block below was given as "ep 41" on the first line and then
# corrected to "all of the time stamps above are ep 34". Taking ep34.
SPANS = [
    (34, "8:58",  "8:59",  "angry_hi",     "angry and threatening, high energy"),
    (34, "9:01",  "9:04",  "angry_hi2",    "angry and threatening, high energy"),
    (34, "9:19",  "9:21",  "laugh2",       "laughing"),
    (34, "9:35",  "10:05", "happy_long",   "monologuing, happy, laughing"),
    (34, "11:45", "11:50", "belittling",   "belittling someone"),
    (34, "12:19", "12:25", "assertive",    "lecturing, being assertive"),
    (34, "12:29", "12:40", "angry_low",    "angry, mid to low energy"),
    (34, "12:57", "13:12", "angry_laugh",  "angry, laughing mid-way to cover it"),
    (47, "20:02", "20:08", "angry",        "angry"),
    (47, "20:27", "20:30", "flustered",    "flustered"),
]


def sec(s: str) -> float:
    m, x = s.split(":")
    return int(m) * 60 + float(x)


def _shim() -> None:
    import sys
    import types

    import torchaudio

    if not hasattr(torchaudio, "list_audio_backends"):
        torchaudio.list_audio_backends = lambda: ["soundfile"]
    if not hasattr(torchaudio, "io"):
        m = types.ModuleType("torchaudio.io")
        m.StreamReader = object
        m.StreamWriter = object
        torchaudio.io = m
        sys.modules["torchaudio.io"] = m
    import huggingface_hub

    if not getattr(huggingface_hub.hf_hub_download, "_beni_shim", False):
        _o = huggingface_hub.hf_hub_download

        def _d(*a, **kw):
            if "use_auth_token" in kw:
                kw["token"] = kw.pop("use_auth_token")
            return _o(*a, **kw)

        _d._beni_shim = True
        huggingface_hub.hf_hub_download = _d


_emb = None


def embed(y: np.ndarray, sr: int):
    global _emb
    import torch

    _shim()
    from speechbrain.inference.speaker import EncoderClassifier

    if _emb is None:
        _emb = EncoderClassifier.from_hparams(
            source="speechbrain/spkrec-ecapa-voxceleb",
            run_opts={"device": "cuda" if torch.cuda.is_available() else "cpu"})
    if sr != 16000:
        import scipy.signal as ss

        y = ss.resample_poly(y, 16000, sr)
    v = _emb.encode_batch(torch.from_numpy(np.asarray(y, dtype="float32")).unsqueeze(0))
    v = v.squeeze().detach().cpu().numpy()
    return v / (np.linalg.norm(v) + 1e-9)


def beni_reference():
    """Averaged embedding of her known-good clips, for a sanity number only."""
    try:
        rows = [json.loads(l) for l in (DATASET / "metadata.jsonl").read_text(encoding="utf-8").splitlines()]
        good = [r for r in rows if r["clean"] and 3 <= r["duration"] <= 9][:24]
        vs = []
        for r in good:
            y, sr = sf.read(DATASET / r["audio"])
            vs.append(embed(y, sr))
        v = np.mean(vs, axis=0)
        return v / np.linalg.norm(v)
    except Exception as e:
        print(f"  (speaker check unavailable: {str(e)[:60]})")
        return None


_asr = None


def transcribe(p: Path) -> str:
    global _asr
    from faster_whisper import WhisperModel

    if _asr is None:
        import torch

        cuda = torch.cuda.is_available()
        _asr = WhisperModel("medium.en", device="cuda" if cuda else "cpu",
                            compute_type="float16" if cuda else "int8")
    segs, _ = _asr.transcribe(str(p), language="en", vad_filter=False, beam_size=5)
    return " ".join(s.text.strip() for s in segs).strip()


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    ref = beni_reference()

    lib_path = ADDON / "voice" / "beni-emotions.json"
    lib = json.loads(lib_path.read_text(encoding="utf-8")) if lib_path.exists() else {}

    for ep, a, b, tag, desc in SPANS:
        voc = WORK / f"ep{ep:02d}.vocals24.wav"
        if not voc.exists():
            print(f"  SKIP {tag}: no music-free audio for ep{ep}")
            continue
        t0, t1 = sec(a), sec(b)
        y, sr = sf.read(voc, start=int(t0 * 24000), stop=int(t1 * 24000))
        if y.ndim > 1:
            y = y.mean(axis=1)
        dest = OUT / f"{tag}.wav"
        sf.write(dest, y, sr)

        text = transcribe(dest)
        sim = float(embed(y, sr) @ ref) if ref is not None else float("nan")
        note = ""
        if sim == sim and sim < 0.55:
            note = "   <-- LOW speaker match, check this one"
        print(f"  {tag:13s} ep{ep} {a}-{b}  {t1-t0:5.1f}s  match {sim:5.2f}  {len(text):3d} chars{note}")

        lib[tag] = {"audio": f"clips/emotions/{tag}.wav", "text": text or "(laughs)",
                    "descriptor": desc, "source": f"ep{ep} {a}-{b}",
                    "voice_match": round(sim, 3) if sim == sim else None}

    lib_path.write_text(json.dumps(lib, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nlibrary now has {len(lib)} anchors")


if __name__ == "__main__":
    main()

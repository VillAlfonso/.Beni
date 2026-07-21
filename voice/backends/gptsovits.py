"""Beni's GPT-SoVITS v2, audio-reference-only voice backend.

Each sentence is synthesized through one of Beni's own emotion clips.  The
server decides the sentence mood; this module maps that mood to a legal
three-to-ten-second reference (or its closest usable fallback) and returns
32 kHz float32 samples.

v2 is intentional: it permits audio-only references.  That avoids making the
quality of a clone depend on the imperfect transcripts stored with old clips.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

from anchors import load_gsv_refs, path_of, resolve_ref

HERE = Path(__file__).resolve().parent.parent
ROOT = HERE.parent
PRODUCTION_RUNTIME = ROOT / "voice-runtime" / "gptsovits"
LEGACY_RUNTIME = ROOT / "voice-runtime" / "tts-eval" / "gptsovits"
# The temporary fallback lets an existing evaluated runtime work if a Windows
# handle blocks its one-time promotion.  Beni.bat uses PRODUCTION_RUNTIME.
RUNTIME = PRODUCTION_RUNTIME if PRODUCTION_RUNTIME.exists() else LEGACY_RUNTIME
REPO = RUNTIME / "repo"
PRETRAINED = REPO / "GPT_SoVITS" / "pretrained_models"

NAME = "gptsovits"
SR_HINT = 32_000

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

_pipe = None
_refs: dict | None = None


def _patch_torchaudio() -> None:
    """Use soundfile for WAV I/O when torchcodec lacks FFmpeg shared DLLs."""
    import numpy as np
    import soundfile as sf
    import torch
    import torchaudio

    def load(filepath, *args, **kwargs):
        data, sample_rate = sf.read(str(filepath), dtype="float32", always_2d=True)
        return torch.from_numpy(np.ascontiguousarray(data.T)), sample_rate

    def save(filepath, source, sample_rate, *args, **kwargs):
        data = source.detach().cpu().numpy() if hasattr(source, "detach") else np.asarray(source)
        sf.write(str(filepath), data.T if data.ndim == 2 else data, int(sample_rate))

    class Info:
        def __init__(self, info):
            self.sample_rate = info.samplerate
            self.num_frames = info.frames
            self.num_channels = info.channels

    torchaudio.load = load
    torchaudio.save = save
    torchaudio.info = lambda filepath, *args, **kwargs: Info(sf.info(str(filepath)))


def _device() -> str:
    """Use CUDA only when Cydonia leaves enough free memory for the voice."""
    try:
        import torch

        free, _ = torch.cuda.mem_get_info()
        return "cuda" if free > 2.5 * 1024**3 else "cpu"
    except Exception:
        return "cpu"


def load():
    """Load GPT-SoVITS v2 lazily so importing the HTTP server stays cheap."""
    global _pipe
    if _pipe is not None:
        return _pipe

    assets = (
        PRETRAINED / "gsv-v2final-pretrained" / "s1bert25hz-5kh-longer-epoch=12-step=369668.ckpt",
        PRETRAINED / "gsv-v2final-pretrained" / "s2G2333k.pth",
        PRETRAINED / "chinese-roberta-wwm-ext-large",
        PRETRAINED / "chinese-hubert-base",
    )
    for asset in assets:
        if not asset.exists():
            raise RuntimeError(f"missing GPT-SoVITS v2 asset: {asset}")

    _patch_torchaudio()
    gsv_package = str(REPO / "GPT_SoVITS")
    if gsv_package not in sys.path:
        sys.path.insert(0, gsv_package)
    os.chdir(REPO)
    from TTS_infer_pack.TTS import TTS, TTS_Config

    device = _device()
    config = {
        "custom": {
            "device": device,
            "is_half": device == "cuda",
            "version": "v2",
            "t2s_weights_path": str(assets[0]),
            "vits_weights_path": str(assets[1]),
            "bert_base_path": str(assets[2]),
            "cnhuhbert_base_path": str(assets[3]),
        }
    }
    _pipe = TTS(TTS_Config(config))
    print(f"GPT-SoVITS v2 ready on {device}")
    return _pipe


def _reference(mood: str) -> str:
    global _refs
    if _refs is None:
        _refs = load_gsv_refs()
    _, ref = resolve_ref(mood, _refs)
    if not ref:
        raise RuntimeError("no GPT-SoVITS references; run voice/build/trim_gsv_refs.py")
    return str(path_of(ref))


def synth(text: str, mood: str):
    """Synthesize one complete sentence through its selected tone reference.

    ``cut5`` is a safety split for an unusually long single sentence.  It does
    not truncate text: every resulting fragment uses the same tone reference.
    """
    import numpy as np

    pipe = load()
    request = {
        "text": text,
        "text_lang": "en",
        "ref_audio_path": _reference(mood),
        "prompt_text": "",
        "prompt_lang": "en",
        "text_split_method": "cut5",
        "batch_size": 1,
        "speed_factor": 1.0,
        "return_fragment": False,
    }
    sample_rate, chunks = SR_HINT, []
    for sample_rate, audio in pipe.run(request):
        chunks.append(audio)
    output = np.concatenate(chunks) if chunks else np.zeros(1, dtype="float32")
    output = np.asarray(output)
    if output.dtype.kind in "iu":
        output = output.astype("float32") / 32768.0
    return np.asarray(output, dtype="float32"), int(sample_rate)

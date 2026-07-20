"""Her voice by cloning — Qwen3-TTS in clone mode, kept working but dormant.

This is what she sounded like before RVC. It clones her timbre from one of her
own clips, chosen by mood, which is why it needs the anchor library and RVC
does not. It is genuinely good, and genuinely slow: a 1.7B model generating
tokens sequentially measured 14.3s to first sentence with Cydonia holding the
GPU, which is the whole reason the everyday path moved.

Its models and venv still live in addons/, which is gitignored and which you may
delete. Deleting it costs you this backend and nothing else — the RVC path
resolves entirely within voice/, voice-runtime/ and data/.

Run through Beni-voice.bat, which launches the server with addons/tts/.venv.
"""
from __future__ import annotations

from pathlib import Path

from anchors import path_of, resolve_ref

HERE = Path(__file__).resolve().parent.parent      # voice/
ROOT = HERE.parent                                  # repo root
MODEL = ROOT / "addons" / "tts" / "models" / "1.7B-Base"

NAME = "qwen"
SR_HINT = 24000

_model = None


def load():
    """Clone mode on the Base model. CPU when the card is full — which it
    usually is, since Cydonia-24B takes about 9 GB of the 16."""
    global _model
    if _model is None:
        import torch
        from qwen_tts import Qwen3TTSModel

        if not MODEL.exists():
            raise RuntimeError(f"missing Qwen model: {MODEL}")
        try:
            free, _ = torch.cuda.mem_get_info()
            device = "cuda:0" if free > 5 * 1024**3 else "cpu"
        except Exception:
            device = "cpu"
        print(f"loading {MODEL} on {device} …")
        _model = Qwen3TTSModel.from_pretrained(
            str(MODEL), device_map=device,
            dtype=torch.bfloat16 if device.startswith("cuda") else torch.float32)
        print("ready")
    return _model


def synth(text: str, mood: str):
    """One sentence, cloned through the clip that best matches the mood.

    Unlike RVC, the mood genuinely selects something here: the reference clip
    carries her timbre, so which one is used decides the register. The server
    retries a failure once, so this doesn't.
    """
    import numpy as np

    _, ref = resolve_ref(mood)
    if not ref:
        raise RuntimeError("no reference clips installed")

    model = load()
    wavs, sr = model.generate_voice_clone(
        text=text, language="English",
        ref_audio=str(path_of(ref)), ref_text=ref["text"])
    return np.asarray(wavs[0], dtype="float32"), int(sr)

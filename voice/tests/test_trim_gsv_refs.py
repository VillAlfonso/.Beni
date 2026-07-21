import numpy as np

from build.trim_gsv_refs import voiced_window


SR = 24_000


def _tone(seconds: float, freq: float = 200.0, sr: int = SR):
    t = np.arange(int(seconds * sr)) / sr
    return (0.2 * np.sin(2 * np.pi * freq * t)).astype("float32")


def test_long_clip_trimmed_into_legal_range():
    out = voiced_window(_tone(20.0), SR)
    assert out is not None
    assert 3.0 <= len(out) / SR <= 10.0


def test_in_range_clip_passes_through():
    out = voiced_window(_tone(6.0), SR)
    assert out is not None
    assert abs(len(out) / SR - 6.0) < 0.5


def test_too_short_clip_is_rejected():
    assert voiced_window(_tone(1.0), SR) is None


def test_leading_silence_is_trimmed():
    y = np.concatenate([np.zeros(int(SR * 1.5), dtype="float32"), _tone(6.0)])
    out = voiced_window(y, SR)
    assert out is not None
    assert float(np.abs(out[: int(SR * 0.1)]).mean()) > 1e-3

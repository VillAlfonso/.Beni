"""Isolate the "robotic / underwater" artifact.

Synthesizes ONE line once, then applies three different pacing treatments to
that identical audio, so the only variable is the time-stretch method:

  ab-1-nostretch.wav  raw model output, nothing applied
  ab-2-phasevocoder   librosa.effects.time_stretch (what shipped — suspect)
  ab-3-ffmpeg-atempo  ffmpeg atempo (WSOLA-style, built for speech)

If 1 sounds clean and 2 sounds underwater, the phase vocoder is the cause and
ffmpeg atempo is the fix. If 1 ALSO sounds underwater, the fault is upstream in
the demucs-isolated anchor instead, and the stretch is innocent.

Run: .venv\\Scripts\\python.exe ab_stretch.py
"""
from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf

ADDON = Path(__file__).resolve().parent
OUT = ADDON / "out" / "ab"
FFMPEG = "C:/ffmpeg/ffmpeg"
RATE = 0.86  # the teasing rate that shipped

LINE = "Or are you just bored? Because if you're looking for directions, I'm afraid I'm just as lost as you are."


def ffmpeg_atempo(samples: np.ndarray, sr: int, rate: float) -> np.ndarray:
    with tempfile.TemporaryDirectory() as td:
        src, dst = Path(td) / "in.wav", Path(td) / "out.wav"
        sf.write(src, samples, sr)
        subprocess.run([FFMPEG, "-y", "-v", "error", "-i", str(src),
                        "-filter:a", f"atempo={rate}", str(dst)], check=True)
        y, _ = sf.read(dst)
        return y


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    import torch
    from qwen_tts import Qwen3TTSModel

    lib = json.loads((ADDON / "voice" / "beni-emotions.json").read_text(encoding="utf-8"))
    ref = lib["teasing"]

    free, _ = torch.cuda.mem_get_info()
    device = "cuda:0" if free > 5 * 1024**3 else "cpu"
    model = Qwen3TTSModel.from_pretrained(
        str(ADDON / "models" / "1.7B-Base"), device_map=device,
        dtype=torch.bfloat16 if device.startswith("cuda") else torch.float32)

    # synthesize ONCE — every variant below is the same audio, processed differently
    parts = [p for p in LINE.replace("? ", "?|").split("|") if p.strip()]
    chunks, sr = [], 24000
    for p in parts:
        wavs, sr = model.generate_voice_clone(
            text=p.strip(), language="English",
            ref_audio=str(ADDON / ref["audio"]), ref_text=ref["text"])
        chunks.append(np.asarray(wavs[0]))
        chunks.append(np.zeros(int(sr * 0.26), dtype=np.asarray(wavs[0]).dtype))
    raw = np.concatenate(chunks)

    sf.write(OUT / "ab-1-nostretch.wav", raw, sr)
    print(f"  ab-1-nostretch.wav      {len(raw)/sr:.1f}s   (raw model output)")

    import librosa

    pv = librosa.effects.time_stretch(np.asarray(raw, dtype="float32"), rate=RATE)
    sf.write(OUT / "ab-2-phasevocoder.wav", pv, sr)
    print(f"  ab-2-phasevocoder.wav   {len(pv)/sr:.1f}s   (librosa — what shipped)")

    fw = ffmpeg_atempo(raw, sr, RATE)
    sf.write(OUT / "ab-3-ffmpeg-atempo.wav", fw, sr)
    print(f"  ab-3-ffmpeg-atempo.wav  {len(fw)/sr:.1f}s   (proposed fix)")

    # and the anchor itself, so the demucs source can be judged directly
    a, asr = sf.read(ADDON / ref["audio"])
    sf.write(OUT / "ab-0-anchor-source.wav", a, asr)
    print(f"  ab-0-anchor-source.wav  {len(a)/asr:.1f}s   (the demucs clip it clones from)")
    print(f"\n-> {OUT}")


if __name__ == "__main__":
    main()

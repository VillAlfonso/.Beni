"""Audition happy + excited before they get wired in.

Two candidate anchors per emotion, mined from HER real lines (the "happy" pair
leads with the clip where she actually laughs). Renders sentence-by-sentence
with breath gaps — the same path server.py now uses — so these samples also
demonstrate the pacing/truncation fix.

Output: out/try-<emotion>-<ref>.wav  +  out/try-<emotion>-<ref>-long.wav
Pick the winners by ear, then they go into voice/beni-refs.json.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from qwen_tts import Qwen3TTSModel

ADDON = Path(__file__).resolve().parent
DATASET = ADDON / "dataset"
OUT = ADDON / "out"

# candidate reference clips (audio path is relative to dataset/)
CANDIDATES = {
    "happy": [
        ("laugh", "wavs/ep15_00389.5.wav",
         "Exactly. It's almost like it was... like it was fate. Haha."),
        ("warm", "wavs/ep47_01078.3.wav",
         "Venetta! Yeah, yeah. I know. I can't really explain it either. What can I say? I'm having"),
    ],
    "excited": [
        ("tada", "wavs/ep15_00053.6.wav",
         "Ta-da! Something tells me this is gonna be fun!"),
        ("clue", "wavs/ep43_00859.0.wav",
         "I finally figured out that stupid clue!"),
    ],
}

# short probe + a long multi-sentence probe (the truncation/pacing test)
PROBES = {
    "happy": [
        "Okay, fine. That was actually funny. Haha. Don't let it go to your head.",
        "You remembered. Huh. Most people don't, you know. They say they will, and then they "
        "just... don't. So, yeah. Thanks. I guess. Anyway, quit smiling like that before I "
        "change my mind about you.",
    ],
    "excited": [
        "Ta-da! Okay, this is gonna be good. Come on, hurry up!",
        "No way. You actually pulled it off! Do you have any idea how long I've been waiting "
        "for someone to do that? Okay, okay. Get up. We're going right now, before I lose my "
        "nerve and pretend I never said any of this.",
    ],
}


def pick_device() -> str:
    try:
        free, _ = torch.cuda.mem_get_info()
        return "cuda:0" if free > 5 * 1024**3 else "cpu"
    except Exception:
        return "cpu"


def main() -> None:
    OUT.mkdir(exist_ok=True)
    device = pick_device()
    print(f"device: {device}  (her 24B brain owns the GPU when it's loaded)")
    model = Qwen3TTSModel.from_pretrained(
        str(ADDON / "models" / "1.7B-Base"), device_map=device,
        dtype=torch.bfloat16 if device.startswith("cuda") else torch.float32)

    import re

    def say(text: str, ref_audio: str, ref_text: str):
        """Per-sentence render + 0.18s breath gaps — server.py's exact path."""
        chunks, sr = [], 24000
        for part in [s for s in re.split(r"(?<=[.!?…])\s+", text) if s.strip()]:
            wavs, sr = model.generate_voice_clone(
                text=part.strip(), language="English",
                ref_audio=str(DATASET / ref_audio), ref_text=ref_text)
            chunks.append(np.asarray(wavs[0]))
            chunks.append(np.zeros(int(sr * 0.18), dtype=np.asarray(wavs[0]).dtype))
        return np.concatenate(chunks), sr

    picked = {}
    for emotion, refs in CANDIDATES.items():
        for name, ref_audio, ref_text in refs:
            for suffix, probe in (("", PROBES[emotion][0]), ("-long", PROBES[emotion][1])):
                out = OUT / f"try-{emotion}-{name}{suffix}.wav"
                samples, sr = say(probe, ref_audio, ref_text)
                sf.write(out, samples, sr)
                print(f"  {out.name}  ({len(samples)/sr:.1f}s)")
            picked[f"{emotion}:{name}"] = {"audio": ref_audio, "text": ref_text}

    (OUT / "try-emotions.json").write_text(json.dumps(picked, indent=2), encoding="utf-8")
    print("\nDONE — listen in addons/tts/out/, then tell me which anchor wins per emotion.")


if __name__ == "__main__":
    main()

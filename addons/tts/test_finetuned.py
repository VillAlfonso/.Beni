"""The moment of truth: her fine-tuned voice, with emotion control.

Generates from the trained `beni` speaker (checkpoint-epoch-9):
  - one sentence in four moods (cold / angry / soft / teasing sass)
  - the three original zero-shot test lines, for direct A/B

Output: addons/tts/out/ft-*.wav
"""
from __future__ import annotations

from pathlib import Path

import soundfile as sf
import torch
from qwen_tts import Qwen3TTSModel

ADDON = Path(__file__).resolve().parent
OUT = ADDON / "out"
CKPT = ADDON / "output-1.7b" / "checkpoint-epoch-9"

MOOD_LINE = "Typical. You really thought that would work on me?"
MOODS = {
    "cold": "Speak coldly and flat, clipped and unimpressed — a sharp-tongued thirteen-year-old girl done with this conversation.",
    "angry": "Speak sharply and angrily, fast and cutting.",
    "soft": "Speak quietly and softly, guarded, almost gentle — armor down an inch.",
    "sass": "Speak playfully and sarcastically with a confident, amused drawl — enjoying this far too much.",
}
AB_LINES = [
    "Did you miss me? Everyone's picking sides again. Booooring.",
    "Typical. You look so cute when you try to think — like a confused puppy.",
    "Don't thank me. It's not like I did it for your sake. I had my own reasons.",
]


def main() -> None:
    model = Qwen3TTSModel.from_pretrained(str(CKPT), device_map="cuda:0", dtype=torch.bfloat16)
    OUT.mkdir(exist_ok=True)
    for mood, instruct in MOODS.items():
        wavs, sr = model.generate_custom_voice(text=MOOD_LINE, language="English",
                                               speaker="beni", instruct=instruct)
        sf.write(OUT / f"ft-mood-{mood}.wav", wavs[0], sr)
        print(f"ft-mood-{mood}.wav")
    for i, line in enumerate(AB_LINES):
        wavs, sr = model.generate_custom_voice(
            text=line, language="English", speaker="beni",
            instruct=MOODS["sass"])
        sf.write(OUT / f"ft-ab-{i}.wav", wavs[0], sr)
        print(f"ft-ab-{i}.wav <- \"{line[:45]}\"")
    print("DONE")


if __name__ == "__main__":
    main()

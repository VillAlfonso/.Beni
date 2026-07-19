"""First sound of her: zero-shot clone test (no fine-tune yet).

Picks the best clean clip from the dataset as the cloning reference (audio +
its exact transcript), synthesizes a few signature lines, writes
addons/tts/out/clone-test-N.wav for the user to judge.

GPU required (run with KoboldCpp stopped). Model downloads on first load.
"""
from __future__ import annotations

import json
from pathlib import Path

import soundfile as sf
import torch
from qwen_tts import Qwen3TTSModel

ADDON = Path(__file__).resolve().parent
DATASET = ADDON / "dataset"
OUT = ADDON / "out"

LINES = [
    "Did you miss me? Everyone's picking sides again. Booooring.",
    "Typical. You look so cute when you try to think — like a confused puppy.",
    "Don't thank me. It's not like I did it for your sake. I had my own reasons.",
]


def main() -> None:
    rows = [json.loads(l) for l in (DATASET / "metadata.jsonl").read_text(encoding="utf-8").splitlines()]
    ref = max((r for r in rows if r["clean"] and 4 <= r["duration"] <= 9),
              key=lambda r: len(r["text"]))
    print(f"reference: {ref['audio']} — \"{ref['text'][:70]}\"")

    model = Qwen3TTSModel.from_pretrained(
        "Qwen/Qwen3-TTS-12Hz-1.7B-Base",
        device_map="cuda:0",
        dtype=torch.bfloat16,
    )
    OUT.mkdir(exist_ok=True)
    for i, line in enumerate(LINES):
        wavs, sr = model.generate_voice_clone(
            text=line,
            language="English",
            ref_audio=str(DATASET / ref["audio"]),
            ref_text=ref["text"],
        )
        sf.write(OUT / f"clone-test-{i}.wav", wavs[0], sr)
        print(f"clone-test-{i}.wav <- \"{line[:50]}\"")
    print("DONE — listen in addons/tts/out/")


if __name__ == "__main__":
    main()

"""Two-track fix for the drifted fine-tune, side by side.

Track A — checkpoint sweep: the sass probe from epochs 2/4/6 (epoch 9 drifted;
earlier ones may keep her timbre + learned prosody).
Track B — mood-by-reference cloning on the BASE model (timbre-true by
construction): reference clip chosen from HER dataset per register.

Output: out/sweep-sass-ep{2,4,6}.wav and out/cloneref-{mood}.wav
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import soundfile as sf
import torch
from qwen_tts import Qwen3TTSModel

ADDON = Path(__file__).resolve().parent
DATASET = ADDON / "dataset"
OUT = ADDON / "out"

PROBE = "Typical. You really thought that would work on me?"

MOOD_PATTERNS = {
    "angry": r"leave me alone|get out|enough|thick skull|not a team",
    "cold": r"none of your business|don'?t care|whatever|boring",
    "soft": r"beautiful|thank you|clover|nice for me|own reasons",
    "sass": r"typical|miss me|charm|princess|slowpoke|cute when",
}


def pick_refs() -> dict[str, dict]:
    rows = [json.loads(l) for l in (DATASET / "metadata.jsonl").read_text(encoding="utf-8").splitlines()]
    usable = [r for r in rows if r["clean"] and 2.5 <= r["duration"] <= 9]
    refs = {}
    for mood, pat in MOOD_PATTERNS.items():
        hits = [r for r in usable if re.search(pat, r["text"], re.I)]
        pool = hits or usable
        refs[mood] = max(pool, key=lambda r: len(r["text"]))
    return refs


def main() -> None:
    OUT.mkdir(exist_ok=True)

    # Track A: checkpoint sweep (custom voice, learned speaker)
    for ep in (2, 4, 6):
        ckpt = ADDON / "output-1.7b" / f"checkpoint-epoch-{ep}"
        model = Qwen3TTSModel.from_pretrained(str(ckpt), device_map="cuda:0", dtype=torch.bfloat16)
        wavs, sr = model.generate_custom_voice(
            text=PROBE, language="English", speaker="beni",
            instruct="Speak playfully and sarcastically with a confident, amused drawl.")
        sf.write(OUT / f"sweep-sass-ep{ep}.wav", wavs[0], sr)
        print(f"sweep-sass-ep{ep}.wav")
        del model
        torch.cuda.empty_cache()

    # Track B: mood-by-reference cloning on the Base model
    refs = pick_refs()
    base = Qwen3TTSModel.from_pretrained(str(ADDON / "models" / "1.7B-Base"),
                                         device_map="cuda:0", dtype=torch.bfloat16)
    for mood, r in refs.items():
        wavs, sr = base.generate_voice_clone(
            text=PROBE, language="English",
            ref_audio=str(DATASET / r["audio"]), ref_text=r["text"])
        sf.write(OUT / f"cloneref-{mood}.wav", wavs[0], sr)
        print(f"cloneref-{mood}.wav  (ref: \"{r['text'][:50]}\")")
    print("DONE")


if __name__ == "__main__":
    main()

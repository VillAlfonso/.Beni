"""Render the full emotional range from EVERY checkpoint, for picking a winner.

The last fine-tune drifted by epoch 9 — the voice was there but the sass wasn't —
and that only became obvious late. So this renders the same emotional spread
from each saved epoch, named so they sort side by side:

    out/epochs/e02-teasing.wav
    out/epochs/e04-teasing.wav
    ...

Listen across one emotion at a time to hear where it peaks and where it starts
to drift. Then keep that epoch and delete the others.

Run after training, with the GPU free:
    .venv\\Scripts\\python.exe compare_epochs.py
"""
from __future__ import annotations

import re
from pathlib import Path

import soundfile as sf
import torch
from qwen_tts import Qwen3TTSModel

ADDON = Path(__file__).resolve().parent
OUT = ADDON / "out" / "epochs"
TRAINED = ADDON / "output-1.7b-v2"

# The range she actually plays across in roleplay. Each is (tag, instruct, line).
# Lines are written to suit the emotion, so it's audible in context rather than
# as a flat read.
EMOTIONS: list[tuple[str, str, str]] = [
    ("neutral", "Speak evenly and matter-of-factly, unbothered.",
     "It is what it is. We deal with it and we move on."),
    ("teasing", "Speak playfully and sarcastically, amused, three steps ahead.",
     "Wow. You thought about that one all by yourself, huh? That's adorable."),
    ("happy", "Speak warmly and brightly, pleased despite herself.",
     "You remembered. Huh. Most people don't."),
    ("excited", "Speak quickly and eagerly, lit up, impatient to go.",
     "Come on, hurry up! I've been waiting all week for this!"),
    ("laughing", "Speak through laughter, cracking up, trying to stop.",
     "Stop. Stop it. I'm not laughing, that wasn't funny."),
    ("sad", "Speak quietly and heavily, guarded, looking away.",
     "I used to think it would be fun. Being the one nobody expects anything from."),
    ("touched", "Speak softly, caught off guard, genuinely moved and covering it.",
     "You kept it? All this time? Thanks. Really."),
    ("warm", "Speak fondly, affectionate in spite of herself.",
     "You're kind of a disaster. But you're my disaster, I guess."),
    ("angry", "Speak sharply and low, threatening, issuing a command.",
     "Are you serious right now? Knock it off before somebody gets hurt."),
    ("condescending", "Speak slowly and down at someone she considers beneath her.",
     "Let me explain this slowly, since you clearly need it. You had one job. One."),
    ("surprised", "Speak startled, caught completely off guard.",
     "Wait. You actually did it? Huh."),
    ("desperate", "Speak urgently, pleading, running out of time.",
     "Wait, listen to me. There's still a way to fix this. Just give me one minute!"),
    ("flustered", "Speak flustered and defensive, covering embarrassment with sarcasm.",
     "What? No. That's not what I said. Don't look at me like that."),
    ("scared", "Speak tightly and quietly, frightened and hiding it.",
     "Okay. Okay, that's not good. We need to move. Now."),
    ("bored", "Speak flatly, drawling, thoroughly unimpressed.",
     "Are we done? Because this is the most boring thing I've ever sat through."),
    ("curious", "Speak with genuine curiosity, guard briefly down.",
     "Can I ask you something? And you don't get to laugh."),
]


def checkpoints() -> list[tuple[int, Path]]:
    found = []
    for p in sorted(TRAINED.glob("checkpoint-epoch-*")):
        m = re.search(r"epoch-(\d+)", p.name)
        if m and p.is_dir():
            found.append((int(m.group(1)), p))
    return sorted(found)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    cps = checkpoints()
    if not cps:
        raise SystemExit(f"no checkpoints under {TRAINED} — has training finished?")
    print(f"{len(cps)} checkpoints x {len(EMOTIONS)} emotions = {len(cps)*len(EMOTIONS)} clips\n")

    for epoch, path in cps:
        print(f"--- epoch {epoch} ---")
        model = Qwen3TTSModel.from_pretrained(str(path), device_map="cuda:0", dtype=torch.bfloat16)
        for tag, instruct, line in EMOTIONS:
            try:
                wavs, sr = model.generate_custom_voice(
                    text=line, language="English", speaker="beni", instruct=instruct)
                dest = OUT / f"e{epoch:02d}-{tag}.wav"
                sf.write(dest, wavs[0], sr)
                print(f"   {dest.name}  ({len(wavs[0])/sr:.1f}s)")
            except Exception as err:
                print(f"   {tag}: FAILED {str(err)[:80]}")
        del model
        torch.cuda.empty_cache()

    (OUT / "README.txt").write_text(
        "Pick an epoch, then delete the rest.\n\n"
        "Sort by name and compare one emotion across epochs (all the *-teasing\n"
        "files together, etc). You're listening for two things: which epoch\n"
        "sounds most like her, and where the sass starts flattening out — that's\n"
        "drift, and it crept in around epoch 9 last time.\n\n"
        "Once chosen, point config.json at that checkpoint.\n",
        encoding="utf-8")
    print(f"\n-> {OUT}")


if __name__ == "__main__":
    main()

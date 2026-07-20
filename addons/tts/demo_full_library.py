"""Render the entire clone-mode library — every anchor, one line each.

Goes through the running server, so this is exactly what the app produces:
same anchor selection, same pacing, same tempo, same non-verbal pasting.

Each file's measured pitch is printed alongside, because the anchors span
236-552 Hz and that spread is why her voice shifts between registers. Seeing
the number next to the sound makes the tradeoff concrete.

Output: out/library/<NN>-<anchor>.wav  +  README.txt
Run with the server up: .venv\\Scripts\\python.exe demo_full_library.py
"""
from __future__ import annotations

import io
import json
import os
import urllib.request
import wave
from pathlib import Path

ADDON = Path(__file__).resolve().parent
OUT = ADDON / "out" / "library"
URL = "http://127.0.0.1:5002"

# A line written to suit each register, so the anchor is heard in context
# rather than reading the same sentence 24 times.
LINES: dict[str, str] = {
    "neutral":      "It is what it is. We deal with it and we move on.",
    "teasing":      "Wow. You thought about that one all by yourself, huh? That's adorable.",
    "teasing_aww":  "Aw, look at you trying. That's almost sweet.",
    "belittling":   "Cute. Did you come up with that yourself, or did it take a group effort.",
    "lecturing":    "Let me explain this slowly, since you clearly need it. You had one job.",
    "assertive":    "We're doing this my way. That part isn't up for discussion.",
    "judging":      "Right. And I'm just supposed to believe that. Sure.",
    "angry":        "Are you serious right now? Knock it off before somebody gets hurt.",
    "angry_hi2":    "Don't you dare. I am not doing this with you again!",
    "angry_low":    "Don't. Whatever you're about to say, just don't.",
    "angry_laugh":  "Oh, that's funny. You think this is funny. It really isn't.",
    "shouting":     "Get back! Move, right now, go!",
    "defensive":    "I never said that. Don't put words in my mouth.",
    "desperate":    "Wait, listen to me. There's still a way to fix this, just give me a minute!",
    "happy":        "You remembered. Huh. Most people don't.",
    "happy_long":   "Okay, that's actually kind of perfect. I'm not saying it twice.",
    "happy_soft":   "Yeah. Yeah, I'd like that. Don't make it weird.",
    "excited":      "Come on, hurry up! I've been waiting all week for this!",
    "laughing":     "Okay, okay. That was actually funny. Don't let it go to your head.",
    "warm":         "You're kind of a disaster. But you're my disaster, I guess.",
    "touched":      "You kept it? All this time? Thanks. Really.",
    "appreciative": "I'm not good at this part. But it mattered. So, thank you.",
    "sad":          "I used to think it would be fun. Being the one nobody expects anything from.",
    "flustered":    "What? No. That's not what I said. Don't look at me like that.",
    "flustered2":   "I wasn't waiting for you. I was just standing here. Obviously.",
    "flustered3":   "Okay, stop. Stop talking. We're not having this conversation.",
}

# the non-verbal leads, shown by the narration that triggers them
NONVERBAL_DEMOS = [
    ("lead-sigh",     '*She sighs, rubbing her eyes.* "Fine. We do it your way. Happy now?"'),
    ("lead-chuckle",  '*She chuckles.* "You are unbelievable, you know that?"'),
    ("lead-chuckle2", '*She laughs quietly under her breath.* "Sure. Whatever you say."'),
]

MIN_CLONE_SEC = 2.5  # shorter references produce garbage


def speak(text: str, mood: str | None = None):
    payload = {"text": text}
    if mood:
        payload["mood"] = mood
    req = urllib.request.Request(URL + "/speak", data=json.dumps(payload).encode(),
                                 headers={"content-type": "application/json"})
    r = urllib.request.urlopen(req, timeout=900)
    first, h = r.read(), dict(r.headers)
    if not h.get("x-voice-rest"):
        return first, h
    rest = urllib.request.urlopen(f"{URL}/rest/{h['x-voice-rest']}", timeout=900).read()
    with wave.open(io.BytesIO(first)) as a, wave.open(io.BytesIO(rest)) as b:
        p = a.getparams()
        frames = a.readframes(a.getnframes()) + b.readframes(b.getnframes())
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(p.nchannels)
        w.setsampwidth(p.sampwidth)
        w.setframerate(p.framerate)
        w.writeframes(frames)
    return buf.getvalue(), h


def pitch(b: bytes) -> float:
    import librosa
    import numpy as np

    with wave.open(io.BytesIO(b)) as w:
        sr = w.getframerate()
        y = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype("float32") / 32768
    f, _, _ = librosa.pyin(y, fmin=80, fmax=600, sr=sr)
    v = f[~np.isnan(f)]
    return float(np.median(v)) if len(v) else float("nan")


def main() -> None:
    import soundfile as sf

    OUT.mkdir(parents=True, exist_ok=True)
    lib = json.loads((ADDON / "voice" / "beni-emotions.json").read_text(encoding="utf-8"))

    usable, short = [], []
    for tag in sorted(lib):
        src = ADDON / lib[tag]["audio"]
        dur = sf.info(src).duration if src.exists() else 0
        (usable if dur >= MIN_CLONE_SEC else short).append(tag)

    print(f"{len(usable)} anchors to render, {len(short)} too short to clone: {', '.join(short)}\n")
    report = []
    for i, tag in enumerate(usable, 1):
        text = LINES.get(tag, LINES["neutral"])
        try:
            wav, h = speak(text, mood=tag)
        except Exception as err:
            print(f"  {tag:14s} FAILED: {str(err)[:70]}")
            continue
        dest = OUT / f"{i:02d}-{tag}.wav"
        dest.write_bytes(wav)
        hz = pitch(wav)
        with wave.open(io.BytesIO(wav)) as w:
            secs = w.getnframes() / w.getframerate()
        line = f"{dest.name:24s} {secs:5.1f}s  {hz:5.0f} Hz   \"{text[:44]}\""
        print(f"  {line}")
        report.append(line)

    print()
    for name, narration in NONVERBAL_DEMOS:
        try:
            wav, h = speak(narration)
        except Exception as err:
            print(f"  {name:14s} FAILED: {str(err)[:70]}")
            continue
        dest = OUT / f"{name}.wav"
        dest.write_bytes(wav)
        with wave.open(io.BytesIO(wav)) as w:
            secs = w.getnframes() / w.getframerate()
        line = f"{dest.name:24s} {secs:5.1f}s          (mood {h.get('x-voice-mood')})"
        print(f"  {line}")
        report.append(line)

    (OUT / "README.txt").write_text(
        "Qwen clone mode - the complete library.\n\n"
        "One line per anchor, chosen to suit that register, rendered through the\n"
        "running server so it matches what the app produces.\n\n"
        "The Hz column is the measured pitch. Her source anchors span 236-552 Hz,\n"
        "and clone mode copies whichever one it is given - so that column is the\n"
        "reason her voice shifts between registers. Anchors far from the 240-300\n"
        "cluster are the ones pulling hardest.\n\n"
        "lead-*.wav show the non-verbal pasting: her real sigh or chuckle in front\n"
        "of a normally-cloned line.\n\n" + "\n".join(report) + "\n",
        encoding="utf-8")
    print(f"\n-> {OUT}")


if __name__ == "__main__":
    main()

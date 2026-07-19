"""Audition the whole reference library.

Sends complete replies — narration and all — through the running server, so the
fixed mood rules, the anchor choice and the per-emotion pacing all get exercised
exactly the way the app uses them. Each line is written the way her replies
actually arrive: stage direction around the spoken part.

First sentence and remainder are stitched back together, so every file is one
whole line you can just play.

Output: out/demo/NN-<emotion>.wav  +  out/demo/README.txt
Run with the server already up:  .venv\\Scripts\\python.exe demo_emotions.py
"""
from __future__ import annotations

import io
import json
import time
import urllib.request
import wave
from pathlib import Path

ADDON = Path(__file__).resolve().parent
OUT = ADDON / "out" / "demo"
URL = "http://127.0.0.1:5002"

# (expected emotion, forced anchor or None, text as her reply would arrive)
LINES: list[tuple[str, str | None, str]] = [
    ("teasing", None,
     'Her tone carries that light, playful edge, like she\'s already three steps ahead of whatever '
     'you\'re about to say and finding it mildly entertaining. The airport noise hums around you both '
     '— luggage carts, distant announcements, the general shuffle of travelers — but she seems '
     'completely unbothered by being approached by a stranger.\n\n'
     '"Or are you just bored?" A small smirk tugs at the corner of her mouth. "Because if you\'re '
     'looking for directions, I\'m afraid I\'m just as lost as you are."'),
    ("teasing", None,
     '*She leans back against the railing, smirking.* "Wow. You thought about that one all by '
     'yourself, huh? That\'s adorable."'),
    ("laughing", None,
     '*She cracks up, covering her mouth with the back of her hand.* "Okay. Okay, no, that was '
     'actually good. Don\'t look so proud of yourself."'),
    ("happy", None,
     '*She smiles before she can stop herself.* "You remembered. Huh. Most people don\'t."'),
    ("excited", None,
     '*She bounces on her heels, eyes lighting up.* "Come on, hurry up! I\'ve been waiting all week '
     'for this!"'),
    ("enthusiastic", None,
     '*She grabs your sleeve, animated.* "No, listen, we do it my way and it actually works. Trust me '
     'for once!"'),
    ("greeting", None,
     '*She waves from across the courtyard, calling out.* "Hey! Over here! You\'re late, you know!"'),
    ("belittling", None,
     '*She looks him up and down, dismissive.* "Cute. Did you come up with that yourself, or did it '
     'take a group effort?"'),
    ("judging", None,
     '*She narrows her eyes, unimpressed.* "Right. And I\'m just supposed to believe that. Sure."'),
    ("angry", None,
     '*She snaps, glaring at him.* "Are you serious right now? Knock it off before somebody gets '
     'hurt!"'),
    ("surprised", None,
     '*She blinks, taken aback.* "Wait. You actually did it? Huh."'),
    ("sad", None,
     '*Her voice goes quiet, and she looks away.* "I used to think it would be fun. Being the one '
     'nobody expects anything from."'),
    ("touched", None,
     '*She softens, caught completely off guard.* "You kept it? All this time? Thanks. Really."'),
    ("desperate", None,
     '*She grabs his arm, pleading.* "Wait, listen to me. There\'s still a way to fix this. Just give '
     'me one minute!"'),
    ("explaining", None,
     '*She points at the map, matter-of-fact.* "It\'s not complicated. The tower is here, we are '
     'here, and that gap is the only way through."'),
    ("asking", None,
     '*She hesitates, then asks quietly.* "Can I ask you something? And you don\'t get to laugh."'),
    ("warm", None,
     '*She leans in, fond despite herself.* "You\'re kind of a disaster. But you\'re my disaster, I '
     'guess."'),
    ("neutral", None,
     '*She shrugs, evenly.* "It is what it is. We deal with it and we move on."'),
    # same line through the alternate anchors, so duplicates can be compared by ear
    ("neutral2", "neutral2",
     '*She shrugs, evenly.* "It is what it is. We deal with it and we move on."'),
    ("neutral3", "neutral3",
     '*She shrugs, evenly.* "It is what it is. We deal with it and we move on."'),
    ("belittling2", "belittling2",
     '*She looks him up and down, dismissive.* "Cute. Did you come up with that yourself, or did it '
     'take a group effort?"'),
]


def post(path: str, payload: dict) -> tuple[bytes, dict]:
    req = urllib.request.Request(URL + path, data=json.dumps(payload).encode(),
                                 headers={"content-type": "application/json"})
    r = urllib.request.urlopen(req, timeout=900)
    return r.read(), dict(r.headers)


def wav_parts(b: bytes) -> tuple[bytes, int, int, int]:
    with wave.open(io.BytesIO(b)) as w:
        return w.readframes(w.getnframes()), w.getnchannels(), w.getsampwidth(), w.getframerate()


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    report: list[str] = []
    print(f"writing to {OUT}\n")

    for i, (expected, forced, text) in enumerate(LINES, 1):
        payload: dict = {"text": text}
        if forced:
            payload["mood"] = forced
        t0 = time.time()
        first, h = post("/speak", payload)
        mood = h.get("x-voice-mood", "?")

        frames, ch, sw, sr = wav_parts(first)
        rest_id = h.get("x-voice-rest")
        if rest_id:
            rr = urllib.request.urlopen(f"{URL}/rest/{rest_id}", timeout=900).read()
            if rr:
                frames += wav_parts(rr)[0]

        name = f"{i:02d}-{mood}.wav"
        with wave.open(str(OUT / name), "wb") as w:
            w.setnchannels(ch)
            w.setsampwidth(sw)
            w.setframerate(sr)
            w.writeframes(frames)

        secs = len(frames) / (sr * ch * sw)
        spoken = text.split('"')[1] if '"' in text else text
        flag = "" if (forced or mood == expected) else f"  <-- rule picked {mood}, expected {expected}"
        line = f'{name:22s} {secs:5.1f}s  "{spoken[:46]}"{flag}'
        print(f"  {line}   ({time.time()-t0:.0f}s)")
        report.append(line)

    (OUT / "README.txt").write_text(
        "Beni voice library audition\n"
        "===========================\n"
        "Each file is one complete reply, rendered the way the app renders it:\n"
        "the narration picks the emotion (fixed rules), the emotion picks the\n"
        "reference clip and the pacing, and only the quoted words are spoken.\n\n"
        "Files 19-21 are the same line through the duplicate anchors, so you can\n"
        "compare neutral / neutral2 / neutral3 and belittling / belittling2 and\n"
        "keep whichever sounds most like her.\n\n"
        + "\n".join(report) + "\n",
        encoding="utf-8")
    print(f"\n{len(LINES)} files -> {OUT}")


if __name__ == "__main__":
    main()

"""Third batch: speech anchors plus a library of non-verbal sounds.

Two kinds of clip here, and the distinction matters:

  SPEECH anchors  — cloned from, the way every anchor works: the model copies
                    the register and speaks new words in it.
  NON-VERBAL      — played back verbatim, never cloned from. Sighs, chuckles
                    and little noticing sounds have no words to learn from, so
                    cloning speech through them produces the same mush the
                    laughing anchor did. Pasting her real sound instead is what
                    actually worked, and it's what stops her sounding flat
                    between sentences.

Cut exactly at the marked timestamps off the demucs vocals track at 24 kHz.
Reference text is read back off each clip with Whisper; non-verbals get a short
descriptive placeholder since there are no words to transcribe.

Run: python build_emotions3.py   (needs the transcribe venv for faster-whisper)
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import soundfile as sf

ADDON = Path(__file__).resolve().parent
ROOT = ADDON.parents[1]
WORK = ROOT / "pipeline" / "transcribe" / "work"
OUT = ADDON / "voice" / "emotions"
NONVERBAL_OUT = ADDON / "voice" / "nonverbal"

# (episode, start, end, tag, descriptor)
SPEECH = [
    (48, "3:09",  "3:18",  "appreciative", "appreciative"),
    (48, "3:32",  "3:44",  "happy_soft",   "happy, softly"),
    (48, "9:28",  "9:29",  "defensive",    "defensive"),
    (48, "10:14", "10:17", "shouting",     "shouting"),
    (48, "10:21", "10:22", "shouting2",    "shouting"),
    (50, "2:22",  "2:25",  "teasing_aww",  "teasing, opening with an 'aww'"),
    (50, "2:29",  "2:35",  "flustered3",   "flustered"),
]

# played verbatim, never cloned from
NONVERBAL = [
    (15, "3:39",  "3:41",  "sigh",           "a sigh"),
    (48, "2:44",  "2:45",  "huh_noticing",   "a soft sigh, noticing something"),
    (48, "9:18",  "9:20",  "chuckle_soft",   "a soft chuckle"),
    (48, "12:27", "12:28", "sigh_relief",    "a sigh of relief"),
    (32, "21:17", "21:18", "chuckle_soft2",  "a soft chuckle"),
]


def sec(s: str) -> float:
    m, x = s.split(":")
    return int(m) * 60 + float(x)


_asr = None


def transcribe(p: Path) -> str:
    global _asr
    from faster_whisper import WhisperModel

    if _asr is None:
        import torch

        cuda = torch.cuda.is_available()
        _asr = WhisperModel("medium.en", device="cuda" if cuda else "cpu",
                            compute_type="float16" if cuda else "int8")
    segs, _ = _asr.transcribe(str(p), language="en", vad_filter=False, beam_size=5)
    return " ".join(s.text.strip() for s in segs).strip()


def cut(ep: int, a: str, b: str, dest: Path):
    voc = WORK / f"ep{ep:02d}.vocals24.wav"
    if not voc.exists():
        return None
    t0, t1 = sec(a), sec(b)
    y, sr = sf.read(voc, start=int(t0 * 24000), stop=int(t1 * 24000))
    if y.ndim > 1:
        y = y.mean(axis=1)
    dest.parent.mkdir(parents=True, exist_ok=True)
    sf.write(dest, y, sr)
    return len(y) / sr


def main() -> None:
    lib_path = ADDON / "voice" / "beni-emotions.json"
    lib = json.loads(lib_path.read_text(encoding="utf-8")) if lib_path.exists() else {}

    print("=== SPEECH anchors (cloned from) ===")
    for ep, a, b, tag, desc in SPEECH:
        dest = OUT / f"{tag}.wav"
        dur = cut(ep, a, b, dest)
        if dur is None:
            print(f"  SKIP {tag}: no audio for ep{ep}")
            continue
        text = transcribe(dest)
        window = "" if 3.0 <= dur <= 10.0 else "   <-- outside 3-10s, needs a reference window"
        print(f"  {tag:14s} ep{ep} {a}-{b}  {dur:5.1f}s  {len(text):3d} chars{window}")
        lib[tag] = {"audio": f"voice/emotions/{tag}.wav", "text": text or "(no words)",
                    "descriptor": desc, "source": f"ep{ep} {a}-{b}"}

    print("\n=== NON-VERBAL (pasted verbatim, never cloned) ===")
    nonverbal = {}
    for ep, a, b, tag, desc in NONVERBAL:
        dest = NONVERBAL_OUT / f"{tag}.wav"
        dur = cut(ep, a, b, dest)
        if dur is None:
            print(f"  SKIP {tag}: no audio for ep{ep}")
            continue
        print(f"  {tag:14s} ep{ep} {a}-{b}  {dur:5.1f}s  {desc}")
        nonverbal[tag] = {"audio": f"voice/nonverbal/{tag}.wav",
                          "descriptor": desc, "source": f"ep{ep} {a}-{b}"}

    lib_path.write_text(json.dumps(lib, indent=2, ensure_ascii=False), encoding="utf-8")
    (ADDON / "voice" / "beni-nonverbal.json").write_text(
        json.dumps(nonverbal, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\n{len(lib)} speech anchors, {len(nonverbal)} non-verbal sounds")


if __name__ == "__main__":
    main()

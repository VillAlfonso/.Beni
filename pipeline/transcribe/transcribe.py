"""Step 1: media in data/episodes/ -> work/epNN.segments.json

Transcribes with faster-whisper large-v3 on GPU. If a subtitle file with the
same stem (.srt/.vtt) sits next to the media, its text is used instead and
Whisper is skipped (subs are perfect text; audio is then only needed for
speaker labeling in step 2).

Usage:
    python transcribe.py            # all episodes found in data/episodes/
    python transcribe.py --only 14  # a single episode
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EPISODES = ROOT / "data" / "episodes"
WORK = Path(__file__).resolve().parent / "work"

MEDIA_EXT = {".mkv", ".mp4", ".avi", ".m4a", ".mp3", ".wav", ".webm", ".ts"}

# eps without an English dub (Japanese audio): Whisper translates ja→en directly
JP_EPS = set(range(49, 53))

# proper nouns Whisper would otherwise mangle ("brave and wolf", "kwarton"…)
HOTWORDS = (
    "Tenkai Knights, Quarton, Bravenwolf, Tributon, Valorn, Lydendor, Venetta, "
    "Dromus, Vilius, Guren Nash, Ceylan, Toxsa, Chooki, Beni, Kiiro, Gen Inukai, "
    "Corekai, Corrupted, Benham City, Boreas, Eurus, Notus, Granox, Slyger, "
    "Beag, Tenkai Energy, Core Bricks, Dragon Cube, robofusion, Mr. White"
)


def episode_number(name: str) -> int | None:
    m = re.search(r"(?:ep|episode|-\s*)(\d{1,2})", name, re.I) or re.search(r"\b(\d{1,2})\b", name)
    return int(m.group(1)) if m else None


def extract_audio(media: Path, wav: Path) -> None:
    wav.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(media), "-ac", "1", "-ar", "16000", "-vn", str(wav)],
        check=True, capture_output=True,
    )


def parse_subtitles(path: Path) -> list[dict]:
    text = path.read_text(encoding="utf-8", errors="replace")
    blocks = re.split(r"\n\s*\n", text)
    out = []
    ts = r"(\d{1,2}):(\d{2}):(\d{2})[.,](\d{3})"
    for block in blocks:
        m = re.search(ts + r"\s*-->\s*" + ts, block)
        if not m:
            continue
        g = [int(x) for x in m.groups()]
        t0 = g[0] * 3600 + g[1] * 60 + g[2] + g[3] / 1000
        t1 = g[4] * 3600 + g[5] * 60 + g[6] + g[7] / 1000
        lines = [l for l in block.splitlines() if "-->" not in l and not l.strip().isdigit()]
        content = re.sub(r"<[^>]+>", "", " ".join(lines)).strip()
        if content:
            out.append({"start": t0, "end": t1, "text": content})
    return out


_whisper = None


def whisper_segments(wav: Path, language: str | None = "en", task: str = "transcribe") -> list[dict]:
    from faster_whisper import WhisperModel

    global _whisper
    if _whisper is None:
        try:
            _whisper = WhisperModel("large-v3", device="cuda", compute_type="float16")
        except Exception:
            print("  CUDA unavailable, falling back to CPU int8 (slow)")
            _whisper = WhisperModel("large-v3", device="cpu", compute_type="int8")
    segments, info = _whisper.transcribe(str(wav), language=language, task=task, vad_filter=True, hotwords=HOTWORDS)
    out = [{"start": s.start, "end": s.end, "text": s.text.strip()} for s in segments if s.text.strip()]
    if language is None:
        print(f"  detected language: {info.language} ({info.language_probability:.2f})")
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", type=int, default=None)
    args = ap.parse_args()

    if not EPISODES.exists():
        sys.exit(f"Put episode files in {EPISODES} first.")
    media = [p for p in sorted(EPISODES.iterdir()) if p.suffix.lower() in MEDIA_EXT]
    if not media:
        sys.exit(f"No media files found in {EPISODES}.")

    for m in media:
        ep = episode_number(m.stem)
        if ep is None:
            print(f"skip (no episode number in name): {m.name}")
            continue
        if args.only and ep != args.only:
            continue
        out = WORK / f"ep{ep:02d}.segments.json"
        wav = WORK / f"ep{ep:02d}.wav"
        print(f"ep{ep:02d}: {m.name}")
        if not wav.exists():
            extract_audio(m, wav)
        vocals = WORK / f"ep{ep:02d}.vocals.wav"
        if vocals.exists():
            wav = vocals  # isolated speech: better VAD + cleaner text

        sub = next((m.with_suffix(ext) for ext in (".srt", ".vtt") if m.with_suffix(ext).exists()), None)
        if sub:
            segs = parse_subtitles(sub)
            print(f"  using subtitles ({len(segs)} cues)")
        elif ep in JP_EPS:
            segs = whisper_segments(wav, language=None, task="translate")
            print(f"  whisper translated {len(segs)} segments to English")
        else:
            segs = whisper_segments(wav)
            print(f"  whisper produced {len(segs)} segments")
        out.write_text(json.dumps({"episode": ep, "segments": segs}, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()

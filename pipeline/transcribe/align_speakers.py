"""Accurate speaker attribution: pyannote turns + Whisper word timestamps.

For each episode (needs work/epNN.segments.json WITH word timestamps + audio):
  1. pyannote diarization -> non-overlapping speaker turns
  2. every transcribed WORD is assigned to the speaker talking at its midpoint
  3. consecutive same-speaker words regroup into clean single-speaker lines
     -> this SPLITS a Whisper segment when two characters share it
  4. each pyannote speaker is embedded (ECAPA) for later name-matching, and a
     few clean clips per speaker are exported for labeling

Outputs (no character names yet — that's name_transcripts.py after enrollment):
  work/epNN.aligned.json     speaker-split lines tagged SPEAKER_00…
  work/epNN.spk_emb.npz      ECAPA embedding per pyannote speaker
  review_spk/epNN/           2–3 clips per speaker for the label sheet

Usage: python align_speakers.py [--only 14]
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import soundfile as sf

import diarize_match as dm

HERE = Path(__file__).resolve().parent
WORK = HERE / "work"
REVIEW_SPK = HERE / "review_spk"
JP_EPS: set[int] = set()  # empty since the EN dub of 49-52 arrived (2026-07-19)


def speaker_at(t: float, turns: list[tuple[float, float, str]]) -> str | None:
    for a, b, spk in turns:
        if a <= t <= b:
            return spk
    return None


def nearest_speaker(t: float, turns: list[tuple[float, float, str]]) -> str:
    best, bd = "SPEAKER_00", 1e9
    for a, b, spk in turns:
        d = 0 if a <= t <= b else min(abs(t - a), abs(t - b))
        if d < bd:
            best, bd = spk, d
    return best


def align(ep: int) -> None:
    seg_file = WORK / f"ep{ep:02d}.segments.json"
    wav_file = WORK / f"ep{ep:02d}.wav"
    vocals = WORK / f"ep{ep:02d}.vocals.wav"
    audio_path = vocals if vocals.exists() else wav_file
    segments = json.loads(seg_file.read_text(encoding="utf-8"))["segments"]

    print(f"ep{ep:02d}: diarizing…")
    turns, spk_emb = dm.diarize_pyannote(audio_path)

    # collect words; fall back to whole-segment timing if a segment lacks words.
    # JP eps (49-52) are TRANSLATED — their word timestamps map English words onto
    # Japanese audio and are unreliable, so attribute whole segments instead.
    words = []
    for s in segments:
        if ep not in JP_EPS and s.get("words"):
            for w in s["words"]:
                if w["w"].strip():
                    words.append({"w": w["w"], "s": w["s"], "e": w["e"]})
        else:
            words.append({"w": s["text"] + " ", "s": s["start"], "e": s["end"]})

    # assign each word to a speaker, then regroup consecutive same-speaker words
    lines: list[dict] = []
    for w in words:
        mid = (w["s"] + w["e"]) / 2
        spk = speaker_at(mid, turns) or nearest_speaker(mid, turns)
        if lines and lines[-1]["speaker"] == spk and w["s"] - lines[-1]["t1"] < 1.5:
            lines[-1]["text"] += w["w"]
            lines[-1]["t1"] = w["e"]
        else:
            lines.append({"speaker": spk, "text": w["w"], "t0": w["s"], "t1": w["e"]})

    # merge consecutive same-speaker lines (< 6s apart) into one clean turn
    merged: list[dict] = []
    for ln in lines:
        if merged and merged[-1]["speaker"] == ln["speaker"] and ln["t0"] - merged[-1]["t1"] < 6.0:
            merged[-1]["text"] += " " + ln["text"]
            merged[-1]["t1"] = ln["t1"]
        else:
            merged.append(ln)
    lines = merged
    for ln in lines:
        ln["text"] = " ".join(ln["text"].split()).strip()
        ln["t0"] = round(ln["t0"], 2)
        ln["t1"] = round(ln["t1"], 2)
    lines = [ln for ln in lines if ln["text"]]

    (WORK / f"ep{ep:02d}.aligned.json").write_text(
        json.dumps({"episode": ep, "lines": lines}, indent=1, ensure_ascii=False), encoding="utf-8"
    )

    # pyannote already gave us a clean embedding per speaker — save it for naming
    np.savez(WORK / f"ep{ep:02d}.spk_emb.npz", **spk_emb)

    # export a few clean clips per speaker for the labeling sheet
    audio, sr = sf.read(audio_path)
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    by_spk: dict[str, list[tuple[float, float]]] = {}
    for a, b, spk in turns:
        if b - a >= 1.5:
            by_spk.setdefault(spk, []).append((a, b))
    rev = REVIEW_SPK / f"ep{ep:02d}"
    rev.mkdir(parents=True, exist_ok=True)
    for spk, spans in by_spk.items():
        spans.sort(key=lambda ab: abs((ab[1] - ab[0]) - 3.5))  # ~3.5s = clean single-voice
        for i, (a, b) in enumerate(spans[:3]):
            sf.write(rev / f"{spk}_sample{i}.wav", audio[int(a * sr): int(b * sr)], sr)

    talk = {}
    for ln in lines:
        talk[ln["speaker"]] = talk.get(ln["speaker"], 0) + (ln["t1"] - ln["t0"])
    print(f"  {len(lines)} lines, {len(by_spk)} speakers "
          f"({', '.join(f'{k}:{v:.0f}s' for k, v in sorted(talk.items(), key=lambda x: -x[1]))})")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", type=int, default=None)
    a = ap.parse_args()
    files = sorted(WORK.glob("ep*.segments.json"))
    failed = []
    for f in files:
        ep = int(f.stem[2:4])
        if a.only and ep != a.only:
            continue
        try:
            align(ep)
        except Exception as e:  # one bad episode must not abort an unattended batch
            failed.append(ep)
            print(f"  ep{ep:02d} FAILED: {str(e).splitlines()[-1][:160]}")
    if failed:
        print(f"\n{len(failed)} episode(s) failed: {failed} — rerun with --only <ep> after checking.")


if __name__ == "__main__":
    main()

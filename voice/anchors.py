"""The library of her real clips.

Two manifests, both tracked, both pointing at audio cut from hand-marked moments
in the episodes with the music stripped out. The audio itself is derived and is
not in git — build_emotions.py cuts it from your local episode files.

Used two different ways. The Qwen backend needs a clip as a voice-cloning
reference, so the timbre comes from her. Every backend needs the nonverbal
sounds, because a sigh or a laugh is played as her actual recording rather than
synthesized — those have no words in them and cloning speech through them
produces mush.
"""
from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
CLIPS = HERE / "clips"

_emotions: dict | None = None
_nonverbal: dict | None = None


def path_of(ref: dict) -> Path:
    """Manifest paths are relative to voice/, so they survive the folder moving."""
    return HERE / ref["audio"]


def load_emotions() -> dict:
    global _emotions
    if _emotions is None:
        p = CLIPS / "beni-emotions.json"
        _emotions = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
        legacy = CLIPS / "beni-refs.json"  # older anchors still answer to their names
        if legacy.exists():
            for k, v in json.loads(legacy.read_text(encoding="utf-8")).items():
                _emotions.setdefault(k, v)
    return _emotions


def load_nonverbal() -> dict:
    global _nonverbal
    if _nonverbal is None:
        p = CLIPS / "beni-nonverbal.json"
        _nonverbal = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
    return _nonverbal


# An anchor only earns its place if it actually sounds like her, so several got
# cut. What's left has to cover for them: each emotion names the nearest
# surviving register rather than letting everything collapse to the default.
MOOD_FALLBACK: dict[str, list[str]] = {
    "enthusiastic": ["excited", "happy"],
    "greeting":     ["excited", "happy"],
    "surprised":    ["excited", "happy"],
    # talking down at someone is its own register, not a flavour of teasing
    "belittling":   ["lecturing", "teasing"],
    "judging":      ["lecturing", "teasing"],
    "explaining":   ["lecturing", "neutral"],
    "angry":        ["desperate", "excited"],
    "asking":       ["neutral", "warm"],
    "laughing":     ["happy", "teasing"],
    # warm was culled for not sounding like her, so anything that leaned on it
    # falls through to the nearest register still in the library
    "warm":         ["happy_soft", "appreciative", "neutral"],
    "touched":      ["appreciative", "sad"],
    "desperate":    ["excited", "teasing"],
    "sad":          ["touched", "neutral"],
    "excited":      ["happy", "teasing"],
    "happy":        ["happy_soft", "teasing"],
    "neutral":      ["lecturing", "teasing"],
    "lecturing":    ["neutral", "teasing"],
}

# Some registers sound more like her through a clip that doesn't share their
# name. Anger reads as threatening when it's delivered like she's talking down
# at someone, rather than the flat legacy anger anchor.
ANCHOR_FOR = {"angry": "lecturing"}

DEFAULT_MOOD = "teasing"  # her resting register: amused, three steps ahead


def resolve_ref(mood: str) -> tuple[str, dict]:
    """The clip for a mood, falling back through nearby registers so a deleted
    anchor degrades to something adjacent instead of breaking playback."""
    lib = load_emotions()
    chain = [ANCHOR_FOR.get(mood), mood, *MOOD_FALLBACK.get(mood, []),
             DEFAULT_MOOD, "neutral", "sass", "default"]
    for m in chain:
        if m and m in lib:
            return (mood if m == ANCHOR_FOR.get(mood) else m), lib[m]
    return (next(iter(lib)), next(iter(lib.values()))) if lib else ("", {})

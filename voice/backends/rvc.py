"""Her voice by conversion, not synthesis.

Windows' own SAPI voice reads the line, and the model trained on her episodes
swaps the timbre. RVC keeps the source's rhythm exactly and changes only who is
speaking, which is why the source matters: whatever pacing Zira gives us is the
pacing she gets.

Zira, not the default David: David sits at ~90 Hz against her ~293 Hz, twenty
semitones apart, and shifts that large wreck the output. Zira measures ~201 Hz,
so the correction is +7 — small enough to be free.

Fast, unlike what came before. Warm conversion runs about 0.4s for five seconds
of speech (~12x realtime) on the GPU. The first call is slower because rmvpe
(181 MB), the retrieval index (185 MB) and CUDA warmup are all paid lazily.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent      # voice/
ROOT = HERE.parent                                  # repo root
RUNTIME = ROOT / "voice-runtime"
PITCH_CACHE = ROOT / "data" / "voice" / "cache" / "zira-pitch.json"

NAME = "rvc"
SR_HINT = 40000  # the model is a 40k v2; vc_single reports the real rate anyway

# The final epoch, named rather than globbed. `beni_s*.pth` and `beni_e*_s*.pth`
# are different files on disk and a glob quietly picks whichever sorts last.
WEIGHT = "beni_e200_s13200.pth"
INDEX = RUNTIME / "assets" / "indices" / "beni_added_IVF1503_Flat_nprobe_1_beni_v2.index"

VOICE = "Microsoft Zira Desktop"
TARGET_HZ = 293.0   # her median pitch, measured across the dataset
INDEX_RATE = 0.5    # how much of the retrieval index to blend in
RMS_MIX = 0.25      # volume-envelope blend; MUST stay in 0..1 — see below
PROTECT = 0.33      # guards breaths and consonants from over-conversion

# vc_single in this fork takes:
#   (sid, path, f0_up_key, f0_method, file_index, index_rate, resample_sr,
#    rms_mix_rate, protect)
#
# Upstream RVC's signature also has f0_file, file_index2 and filter_radius, and
# the standalone scripts in voice-runtime/ were written against that one. Their
# arguments land shifted by two, which puts 3 into rms_mix_rate. At 3 the
# envelope blend computes rms1^-2 * rms2^2 and the output collapses to
# near-silence with clipping spikes — no pitch detectable anywhere in it.
# Anything in 0..1 sounds correct; this is the one call that must not drift.

_vc = None
_up_key: int | None = None


def _powershell(script: str) -> subprocess.CompletedProcess:
    return subprocess.run(["powershell.exe", "-NoProfile", "-Command", script],
                          capture_output=True, text=True)


def say(text: str, dest: Path) -> None:
    """Render one line with SAPI, passing the text by file rather than inline.

    Her replies are full of apostrophes, and a single-quoted PowerShell literal
    ends at the first one — which is why the older scripts here carry test lines
    written without any. Reading a UTF-8 file means only a path we generated
    reaches the command line, so contractions, curly quotes and em-dashes all
    survive and nothing in her words can be interpreted as script.
    """
    fd, txt = tempfile.mkstemp(suffix=".txt")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
        r = _powershell(
            "Add-Type -AssemblyName System.Speech; "
            f"$t = [IO.File]::ReadAllText('{txt}', [Text.Encoding]::UTF8); "
            "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
            f"$s.SelectVoice('{VOICE}'); "
            f"$s.SetOutputToWaveFile('{dest}'); "
            "$s.Rate = 0; $s.Speak($t); $s.Dispose()"
        )
    finally:
        try:
            os.unlink(txt)
        except OSError:
            pass
    if not dest.exists() or dest.stat().st_size == 0:
        raise RuntimeError(f"SAPI produced nothing: {(r.stderr or r.stdout)[:200]}")


def _median_hz(p: Path) -> float:
    import librosa
    import numpy as np
    import soundfile as sf

    y, sr = sf.read(p)
    y = np.asarray(y, dtype="float32")
    if y.ndim > 1:
        y = y.mean(axis=1)
    f, _, _ = librosa.pyin(y, fmin=60, fmax=700, sr=sr)
    v = f[~np.isnan(f)]
    return float(np.median(v)) if len(v) > 5 else float("nan")


def up_key() -> int:
    """Semitones from Zira to her range, measured once and remembered.

    Her pitch is a property of the voice, not of the sentence, so paying
    librosa.pyin on every line would be pure waste — it costs more than the
    conversion does.
    """
    global _up_key
    if _up_key is not None:
        return _up_key

    if PITCH_CACHE.exists():
        try:
            got = json.loads(PITCH_CACHE.read_text(encoding="utf-8"))
            if got.get("voice") == VOICE and got.get("target") == TARGET_HZ:
                _up_key = int(got["up_key"])
                return _up_key
        except Exception:
            pass  # a corrupt cache is not worth failing over; just re-measure

    import numpy as np

    with tempfile.TemporaryDirectory() as td:
        cal = Path(td) / "cal.wav"
        say("So what exactly is your plan here, genius?", cal)
        hz = _median_hz(cal)
    if hz != hz:  # NaN
        raise RuntimeError("could not measure the source voice's pitch")

    _up_key = int(round(12 * np.log2(TARGET_HZ / hz)))
    PITCH_CACHE.parent.mkdir(parents=True, exist_ok=True)
    PITCH_CACHE.write_text(json.dumps(
        {"voice": VOICE, "source_hz": round(hz, 1), "target": TARGET_HZ,
         "up_key": _up_key}, indent=2), encoding="utf-8")
    print(f"source voice {VOICE} at {hz:.0f} Hz -> {_up_key:+d} semitones")
    return _up_key


def load():
    """Bring RVC up. Deferred so importing this module stays cheap.

    The library resolves assets/ against the working directory and reads its
    roots from the environment, defaulting to the literal string "None/" when
    they are unset, so both have to be in place before anything is imported.
    """
    global _vc
    if _vc is not None:
        return _vc

    weight = RUNTIME / "assets" / "weights" / WEIGHT
    if not weight.exists():
        raise RuntimeError(f"missing RVC weights: {weight}")
    if not INDEX.exists():
        raise RuntimeError(f"missing retrieval index: {INDEX}")

    sys.path.insert(0, str(RUNTIME))
    os.chdir(RUNTIME)
    for k, v in (("weight_root", "assets/weights"), ("index_root", "logs"),
                 ("rmvpe_root", "assets/rmvpe"), ("outside_index_root", "assets/indices")):
        os.environ.setdefault(k, v)

    argv, sys.argv = sys.argv, sys.argv[:1]  # Config parses argv and rejects unknown flags
    try:
        from configs.config import Config
        from infer.vc.modules import VC

        cfg = Config()
        _vc = VC(cfg)
        _vc.get_vc(WEIGHT)
        print(f"RVC ready — {WEIGHT} on {cfg.device} (half={cfg.is_half})")
    finally:
        sys.argv = argv
    return _vc


def synth(text: str, mood: str):
    """One sentence in her voice. `mood` is accepted and ignored.

    Under cloning the mood chose a reference clip, because the reference carried
    the timbre. Here the timbre is the model, so mood has nothing to select —
    it still shapes delivery, but through the pacing and tempo tables the server
    applies around this call.
    """
    import numpy as np

    vc = load()
    with tempfile.TemporaryDirectory() as td:
        src = Path(td) / "src.wav"
        say(text, src)
        info, opt = vc.vc_single(0, str(src), up_key(), "rmvpe", str(INDEX),
                                 INDEX_RATE, 0, RMS_MIX, PROTECT)
    if opt is None:
        raise RuntimeError(f"conversion returned nothing: {str(info)[:200]}")

    sr, audio = opt
    audio = np.asarray(audio)
    if audio.dtype.kind == "i":  # RVC hands back int16; the pipeline wants float
        audio = audio.astype("float32") / 32768.0
    return np.asarray(audio, dtype="float32"), int(sr)

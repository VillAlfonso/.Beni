"""Pick the pitch correction for the bright registers by ear.

The first attempt aimed happy and excited at her NEUTRAL pitch (~274 Hz), which
was wrong: she genuinely is higher when she's excited, and flattening that
removed the emotion along with the helium. Her own anchors sit at 351 Hz (happy)
and 415 Hz (excited) — those are the targets.

Renders the same line at several correction strengths so the choice is made by
listening, not by me picking a number. Writes measured pitch alongside each file
so the numbers and the ear can be compared.

Run:  .venv\\Scripts\\python.exe pitch_ab.py
Out:  out/pitch/<emotion>-p<NN>.wav
"""
from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf

ADDON = Path(__file__).resolve().parent
OUT = ADDON / "out" / "pitch"
FFMPEG = "C:/ffmpeg/ffmpeg"

# emotion -> (line, her real anchor pitch, correction strengths to try)
CASES = {
    "happy": ("You remembered. Huh. Most people don't.", 351,
              [1.00, 0.94, 0.88, 0.82]),
    "excited": ("Come on, hurry up! I've been waiting all week for this!", 415,
                [1.00, 0.94, 0.88, 0.82]),
}


def shift(y, sr, pitch):
    """Pitch-shift while holding duration (asetrate + atempo)."""
    if abs(pitch - 1.0) < 0.005:
        return y
    with tempfile.TemporaryDirectory() as td:
        src, dst = Path(td) / "i.wav", Path(td) / "o.wav"
        sf.write(src, np.asarray(y, dtype="float32"), sr)
        chain = f"asetrate={sr}*{pitch:.4f},aresample={sr},atempo={1/pitch:.4f}"
        subprocess.run([FFMPEG, "-y", "-v", "error", "-i", str(src),
                        "-filter:a", chain, str(dst)], check=True, timeout=60)
        out, _ = sf.read(dst)
        return np.asarray(out, dtype="float32")


def f0(y, sr):
    import librosa

    f, _, _ = librosa.pyin(np.asarray(y, dtype="float32"), fmin=80, fmax=700, sr=sr)
    v = f[~np.isnan(f)]
    return float(np.median(v)) if len(v) else float("nan")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    import torch
    from qwen_tts import Qwen3TTSModel

    lib = json.loads((ADDON / "voice" / "beni-emotions.json").read_text(encoding="utf-8"))
    free, _ = torch.cuda.mem_get_info()
    device = "cuda:0" if free > 5 * 1024**3 else "cpu"
    print(f"device: {device} (training owns the GPU, so CPU is expected)\n")
    model = Qwen3TTSModel.from_pretrained(
        str(ADDON / "models" / "1.7B-Base"), device_map=device,
        dtype=torch.bfloat16 if device.startswith("cuda") else torch.float32)

    report = []
    for emotion, (line, target, strengths) in CASES.items():
        ref = lib[emotion]
        # synthesize ONCE; every variant is the same audio at a different shift
        wavs, sr = model.generate_voice_clone(
            text=line, language="English",
            ref_audio=str(ADDON / ref["audio"]), ref_text=ref["text"])
        raw = np.asarray(wavs[0], dtype="float32")
        print(f"--- {emotion} (her real anchor: {target} Hz) ---")
        for p in strengths:
            y = shift(raw, sr, p)
            name = f"{emotion}-p{int(p*100):03d}.wav"
            sf.write(OUT / name, y, sr)
            hz = f0(y, sr)
            tag = "  <-- closest to her anchor" if abs(hz - target) < 30 else ""
            line_out = f"  {name:22s} {hz:6.1f} Hz{tag}"
            print(line_out)
            report.append(line_out)

    (OUT / "README.txt").write_text(
        "Pitch correction for the bright registers.\n\n"
        "p100 = no correction at all (what the model produces raw).\n"
        "Lower numbers pull the pitch down harder.\n\n"
        "Her own recorded anchors sit at 351 Hz (happy) and 415 Hz (excited).\n"
        "She IS higher when excited — the goal is to stop the model overshooting\n"
        "into helium, not to flatten her to her neutral 274 Hz, which is the\n"
        "mistake the first correction made.\n\n"
        "Pick one per emotion and tell me; it's a single number in server.py.\n\n"
        + "\n".join(report) + "\n",
        encoding="utf-8")
    print(f"\n-> {OUT}")


if __name__ == "__main__":
    main()

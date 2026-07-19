"""Beni voice server — standalone, decoupled from the app.

Serves POST /speak {"text": "...", "instruct": "..."} -> audio/wav
       GET  /health -> {"ok": true, "loaded": bool}

Loads the fine-tuned checkpoint named in config.json (created by training);
falls back to the newest checkpoint in output/. Model loads lazily on the
first request. Default port 5002. The main app proxies /api/tts here so the
phone (through the tunnel) can use her voice too.

Run: .venv\\Scripts\\python.exe server.py          (or Beni-voice.bat)
"""
from __future__ import annotations

import io
import json
import re
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

ADDON = Path(__file__).resolve().parent
PORT = 5002

DEFAULT_INSTRUCT = (
    "Speak as a sharp-tongued, playfully sarcastic thirteen-year-old girl — "
    "quick, teasing, faintly amused, with a confident drawl."
)

_model = None
_refs = None


def load_refs() -> dict:
    global _refs
    if _refs is None:
        _refs = json.loads((ADDON / "voice" / "beni-refs.json").read_text(encoding="utf-8"))
    return _refs


def load_model():
    """Serve in CLONE mode on the Base model — the user-approved recipe:
    timbre cloned from her real clips, mood steered by which approved anchor
    is used as the reference. Falls back to CPU if the GPU is full (KoboldCpp)."""
    global _model
    if _model is None:
        import torch
        from qwen_tts import Qwen3TTSModel

        base = str(ADDON / "models" / "1.7B-Base")
        try:
            free, _ = torch.cuda.mem_get_info()
            device = "cuda:0" if free > 5 * 1024**3 else "cpu"
        except Exception:
            device = "cpu"
        print(f"loading {base} on {device} …")
        _model = Qwen3TTSModel.from_pretrained(
            base, device_map=device,
            dtype=torch.bfloat16 if device.startswith("cuda") else torch.float32)
        print("ready")
    return _model


def clean_text(t: str) -> str:
    t = re.sub(r"\*[^*]*\*", " ", t)  # strip action beats — speak only her words
    t = re.sub(r"\s+", " ", t).strip()
    return t[:400]


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):  # quiet
        pass

    def do_GET(self):
        if self.path == "/health":
            body = json.dumps({"ok": True, "loaded": _model is not None}).encode()
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path != "/speak":
            self.send_response(404)
            self.end_headers()
            return
        try:
            n = int(self.headers.get("content-length", 0))
            req = json.loads(self.rfile.read(n) or b"{}")
            text = clean_text(str(req.get("text", "")))
            if not text:
                raise ValueError("empty text")
            mood = str(req.get("mood") or "default")
            refs = load_refs()
            ref = refs.get(mood, refs["default"])

            import soundfile as sf

            model = load_model()
            wavs, sr = model.generate_voice_clone(
                text=text, language="English",
                ref_audio=str(ADDON / ref["audio"]), ref_text=ref["text"]
            )
            buf = io.BytesIO()
            sf.write(buf, wavs[0], sr, format="WAV")
            data = buf.getvalue()
            self.send_response(200)
            self.send_header("content-type", "audio/wav")
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:  # report, don't die
            body = json.dumps({"error": str(e)[:300]}).encode()
            self.send_response(500)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)


if __name__ == "__main__":
    print(f"Beni voice server on http://127.0.0.1:{PORT}")
    HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()

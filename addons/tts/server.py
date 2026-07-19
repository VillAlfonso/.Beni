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
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ADDON = Path(__file__).resolve().parent
PORT = 5002

DEFAULT_INSTRUCT = (
    "Speak as a sharp-tongued, playfully sarcastic thirteen-year-old girl — "
    "quick, teasing, faintly amused, with a confident drawl."
)

_model = None
_refs = None
_model_lock = threading.Lock()  # one synthesis at a time
_rest_jobs: dict[str, dict] = {}  # id -> {"event": Event, "wav": bytes|None}


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
        if self.path.startswith("/rest/"):
            job = _rest_jobs.get(self.path.rsplit("/", 1)[-1])
            if not job:
                self.send_response(404)
                self.end_headers()
                return
            job["event"].wait(timeout=180)
            data = job.pop("wav", None)
            if not data:
                self.send_response(504)
                self.end_headers()
                return
            self.send_response(200)
            self.send_header("content-type", "audio/wav")
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
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

            def synth(t: str) -> bytes:
                with _model_lock:
                    model = load_model()
                    wavs, sr = model.generate_voice_clone(
                        text=t, language="English",
                        ref_audio=str(ADDON / ref["audio"]), ref_text=ref["text"])
                buf = io.BytesIO()
                sf.write(buf, wavs[0], sr, format="WAV")
                return buf.getvalue()

            # perceived-latency trick: return the FIRST sentence fast, render
            # the rest in the background; client fetches /rest/<id> during playback
            sentences = re.split(r"(?<=[.!?…])\s+", text)
            first = sentences[0]
            rest = " ".join(sentences[1:]).strip()
            # first sentence FIRST (it must win the model lock), rest in background
            data = synth(first)
            job_id = ""
            if rest:
                job_id = uuid.uuid4().hex[:12]
                job = {"event": threading.Event(), "wav": None}
                _rest_jobs[job_id] = job

                def bg():
                    try:
                        job["wav"] = synth(rest)
                    finally:
                        job["event"].set()

                threading.Thread(target=bg, daemon=True).start()
            self.send_response(200)
            self.send_header("content-type", "audio/wav")
            self.send_header("content-length", str(len(data)))
            if job_id:
                self.send_header("x-voice-rest", job_id)
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
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()

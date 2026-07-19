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

import hashlib
import io
import json
import re
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ADDON = Path(__file__).resolve().parent
CACHE = ADDON / "cache"    # rendered lines, keyed by mood+text — replay is instant
SPOKEN = ADDON / "spoken"  # lines she actually finished saying, named by her words
PORT = 5002

DEFAULT_INSTRUCT = (
    "Speak as a sharp-tongued, playfully sarcastic thirteen-year-old girl — "
    "quick, teasing, faintly amused, with a confident drawl."
)

_model = None
_refs = None
_model_lock = threading.Lock()  # one synthesis at a time
_rest_jobs: dict[str, dict] = {}  # id -> {"event": Event, "wav": bytes|None}
_finished: dict[str, tuple] = {}  # voice_id -> (samples, sr) — completed lines, LRU-ish


def _finish_voice(voice_id: str, samples, sr: int) -> None:
    _finished[voice_id] = (samples, sr)
    while len(_finished) > 8:
        _finished.pop(next(iter(_finished)))


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
    return t[:900]


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
        if self.path == "/keep":
            # playback finished uninterrupted -> archive it, named by her words
            try:
                import soundfile as sf

                n = int(self.headers.get("content-length", 0))
                req = json.loads(self.rfile.read(n) or b"{}")
                vid = str(req.get("voice_id", ""))
                text = clean_text(str(req.get("text", ""))) or "line"
                got = _finished.pop(vid, None)
                if got:
                    safe = re.sub(r"[^\w \-']", "", text)[:60].strip() or "line"
                    SPOKEN.mkdir(exist_ok=True)
                    sf.write(SPOKEN / f"{safe}.wav", got[0], got[1])
                body = json.dumps({"kept": bool(got)}).encode()
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except Exception:
                self.send_response(500)
                self.end_headers()
            return
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

            import numpy as np
            import soundfile as sf

            # replay cache: same line + mood -> serve the finished wav instantly
            cache_key = hashlib.sha1(f"{mood}|{text}".encode("utf-8")).hexdigest()[:16]
            CACHE.mkdir(exist_ok=True)
            cached = CACHE / f"{cache_key}.wav"
            voice_id = uuid.uuid4().hex[:12]
            if cached.exists():
                samples, sr = sf.read(cached)
                _finish_voice(voice_id, samples, sr)
                data = cached.read_bytes()
                self.send_response(200)
                self.send_header("content-type", "audio/wav")
                self.send_header("content-length", str(len(data)))
                self.send_header("x-voice-id", voice_id)
                self.send_header("x-voice-cached", "1")
                self.end_headers()
                self.wfile.write(data)
                return

            def synth_raw(t: str):
                """One sentence -> (samples, sr); retry once on a model hiccup
                so a bad sample never silently swallows part of her line."""
                last = None
                for attempt in (0, 1):
                    try:
                        with _model_lock:
                            model = load_model()
                            wavs, sr = model.generate_voice_clone(
                                text=t, language="English",
                                ref_audio=str(ADDON / ref["audio"]), ref_text=ref["text"])
                        return wavs[0], sr
                    except Exception as e:
                        last = e
                raise last

            def sentences_to_wav(parts):
                """Synthesize sentence by sentence — short inputs keep natural
                pacing and can't drop tails — joined with small breath gaps."""
                chunks, sr = [], 24000
                for p in parts:
                    if not p.strip():
                        continue
                    samples, sr = synth_raw(p.strip())
                    chunks.append(np.asarray(samples))
                    chunks.append(np.zeros(int(sr * 0.18), dtype=np.asarray(samples).dtype))
                joined = np.concatenate(chunks) if chunks else np.zeros(1, dtype="float32")
                buf = io.BytesIO()
                sf.write(buf, joined, sr, format="WAV")
                return buf.getvalue(), joined, sr

            def save_cache(samples, sr):
                try:
                    sf.write(cached, samples, sr)
                except Exception:
                    pass

            # stream: first sentence now, the rest rendered during playback
            sentences = [s for s in re.split(r"(?<=[.!?…])\s+", text) if s.strip()]
            first_wav, first_samples, sr0 = sentences_to_wav(sentences[:1])
            job_id = ""
            if len(sentences) > 1:
                job_id = uuid.uuid4().hex[:12]
                job = {"event": threading.Event(), "wav": None}
                _rest_jobs[job_id] = job

                def bg():
                    try:
                        wav, samples, sr = sentences_to_wav(sentences[1:])
                        job["wav"] = wav
                        full = np.concatenate([first_samples, samples])
                        _finish_voice(voice_id, full, sr)
                        save_cache(full, sr)
                    finally:
                        job["event"].set()

                threading.Thread(target=bg, daemon=True).start()
            else:
                _finish_voice(voice_id, first_samples, sr0)
                save_cache(first_samples, sr0)

            self.send_response(200)
            self.send_header("content-type", "audio/wav")
            self.send_header("content-length", str(len(first_wav)))
            self.send_header("x-voice-id", voice_id)
            if job_id:
                self.send_header("x-voice-rest", job_id)
            self.end_headers()
            self.wfile.write(first_wav)
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

"""Beni voice server — standalone, decoupled from the app.

  POST /speak {"text": "...", "mood": "..."} -> audio/wav (first sentence)
  GET  /rest/<id>                            -> audio/wav (the remainder)
  POST /keep  {"voice_id","text"}            -> file a finished line
  GET  /health

Two backends, one port, chosen by the launcher:

  --backend rvc    Windows SAPI reads the line, the model trained on her
                   episodes swaps the timbre. Fast. The everyday path.
  --backend qwen   Clone mode on the 1.7B Base model, using her own clips as
                   references. Better in places, far slower. Dormant.

Only one runs at a time — you start Beni.bat or Beni-voice.bat, not both — so
sharing :5002 is safe and the app never has to know which it got.

Mood is chosen by FIXED RULES, not by asking a model: her replies carry their
own stage direction ("*a small smirk*", or narration around the quoted line),
so the descriptor is scored against a keyword table and the winning emotion
picks the pacing, the tempo, and which of her real sounds leads the line.
Deterministic, inspectable, free.

Everything here is backend-independent. The backends only turn one sentence of
text into samples; the shaping around them is shared.

Run: voice-runtime\\.venv\\Scripts\\python.exe server.py   (or Beni.bat)
"""
from __future__ import annotations

import argparse
import hashlib
import importlib
import io
import json
import re
import sys
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))  # so backends/ can import anchors regardless of cwd

# Her audio lives with her chat history, not with the code. RVC chdir's into
# voice-runtime/, so every path here is absolute on purpose.
CACHE = ROOT / "data" / "voice" / "cache"    # rendered lines — replay is instant
SPOKEN = ROOT / "data" / "voice" / "spoken"  # lines she finished, named by her words
PORT = 5002
FFMPEG = "C:/ffmpeg/ffmpeg"

_backend = None
_backend_lock = threading.Lock()  # one synthesis at a time; RVC chdir's, so this matters
_rest_jobs: dict[str, dict] = {}
_finished: dict[str, tuple] = {}

from anchors import DEFAULT_MOOD, load_emotions, load_nonverbal, path_of  # noqa: E402


def load_backend(name: str = ""):
    """Import the selected backend and nothing else.

    Each one needs a different venv — RVC's dependencies and Qwen's cannot
    coexist — so the launcher picks the interpreter and this picks the module
    to match. Importing the other would fail here, which is why it is lazy.
    """
    global _backend
    if _backend is None:
        _backend = importlib.import_module(f"backends.{name or 'rvc'}")
    return _backend


# --------------------------------------------------------------------------
# emotion selection — fixed rules over her own stage directions
# --------------------------------------------------------------------------

# Each emotion scores on words appearing in the narration/action beats around
# her line (weighted 3x, since that text literally describes her state) and in
# the spoken words themselves (weighted 1x). Highest score wins; ties fall back
# to DEFAULT_MOOD. Order here is only for readability.
MOOD_RULES: dict[str, list[str]] = {
    "laughing":     [r"laugh", r"giggl", r"cackl", r"snicker", r"cracks up", r"\bhaha", r"\bhehe"],
    "happy":        [r"\bhappy", r"\bsmil", r"\bbeams?\b", r"delight", r"pleased", r"cheerful", r"brightens"],
    "excited":      [r"excit", r"\beager", r"can'?t wait", r"thrill", r"bounc", r"lights? up", r"buzzing"],
    "enthusiastic": [r"enthusiast", r"\bkeen\b", r"\bhypes?\b", r"animated", r"\bperks? up"],
    "greeting":     [r"\bwaves?\b", r"waving", r"calls? out", r"shouts? (?:over|across)", r"\bhey!", r"from afar"],
    "teasing":      [r"teas", r"smirk", r"\bsmug", r"playful", r"needl", r"\bsly\b", r"mischiev", r"\bgrins?\b"],
    "belittling":   [r"belittl", r"conde?scend", r"scoff", r"sneer", r"dismissiv", r"mock", r"looks? down", r"\bpity"],
    "judging":      [r"judg", r"apprais", r"sizes? (?:him|her|them|you) up", r"skeptic", r"suspicio", r"narrows? her eyes", r"unimpressed"],
    "angry":        [r"angr", r"\bfurious", r"snaps?\b", r"snarl", r"glare", r"shouts?\b", r"yell", r"seeth", r"\bsharp(?:ly)?\b"],
    "surprised":    [r"surpris", r"startl", r"\bblinks?\b", r"taken aback", r"stunned", r"\bgapes?\b", r"eyes widen"],
    "sad":          [r"\bsad", r"melanchol", r"\bquiet(?:ly)?\b", r"\bsoft(?:ly)?\b", r"wistful", r"trails? off", r"looks? away", r"\bsighs?\b"],
    "touched":      [r"touched", r"\bmoved\b", r"grateful", r"apprecia", r"\bthank", r"\bgentle", r"softens"],
    "desperate":    [r"desperat", r"plead", r"\bbegs?\b", r"urgent", r"\bfrantic", r"bargain", r"negotiat"],
    "explaining":   [r"explain", r"\bpoints? out", r"clarif", r"matter-of-fact", r"\bnotes?\b", r"\binforms?\b"],
    "asking":       [r"\basks?\b", r"\bwonders?\b", r"\bcurious", r"hesitat", r"\brequests?\b", r"tentativ"],
    "warm":         [r"\bwarm", r"\bfond", r"affection", r"\bkind(?:ly)?\b", r"leans? in"],
    "neutral":      [r"\bflat(?:ly)?\b", r"\bevenly\b", r"deadpan", r"shrugs?\b", r"\bcalm"],
}

# Her laugh is a SOUND, not a way of speaking. The laughing anchor is pure
# laughter with no words in it, so cloning sentences through it always came out
# wrong. Instead her real laugh is played as-is and the words follow in a
# register that works — no cloning artifacts on the laugh at all.
LAUGH_ANCHOR = "laughing"
LAUGH_SPEECH_MOOD = "teasing"  # her normal pitch; happy clones far too high after a laugh
LAUGH_MAX = 2.6   # the clip is the laugh alone (ep15 0:59-1:02), so it plays
                  # essentially whole without dragging speech in front of it
LAUGH_GAP = 0.22  # breath between laughing and talking

# The same idea, generalised. Sighs, chuckles and little noticing sounds have no
# words in them, so cloning speech through them produces mush — the laughing
# anchor proved that. Her real recording is pasted in front of the line instead.
#
# This is also the closest thing available to prosody control: Qwen's clone mode
# ignores `instruct` entirely (verified — byte-identical output for "shout
# furiously" and "whisper gently"), so the anchor plus these sounds ARE the
# expressive range. A line that opens with her actual sigh stops sounding like
# a machine reading a sentence.
# Order matters: the first match wins, so the specific cases are listed above
# the general ones ("sighs with relief" must not fall through to a plain sigh).
NONVERBAL_RULES: dict[str, list[str]] = {
    "sigh_relief":   [r"sighs? (?:in|with) relief", r"relieved sigh", r"breathes? out",
                      r"relief"],
    "chuckle_soft2": [r"quiet(?:ly)? laughs?", r"under her breath", r"stifles? a laugh"],
    "chuckle_soft":  [r"\bchuckles?\b", r"soft laugh", r"\bsnickers?\b", r"huffs? a laugh"],
    "huh_noticing":  [r"\bhuh\b", r"\bnotices?\b", r"catches? sight", r"\bpauses?\b",
                      r"\bblinks?\b"],
    "sigh":          [r"\bsighs?\b", r"\bsighing\b", r"lets? out a breath", r"exhales?\b"],
}
_NONVERBAL_RE = {k: [re.compile(p, re.I) for p in v] for k, v in NONVERBAL_RULES.items()}
NONVERBAL_MAX = 2.2
NONVERBAL_GAP = 0.20

# Sentence gap per emotion, in seconds. Her biggest complaint was rushing, so
# the floor is generous and reflective moods breathe more than excited ones.
PACING: dict[str, float] = {
    "excited": 0.16, "enthusiastic": 0.17, "greeting": 0.18, "laughing": 0.20,
    "happy": 0.22, "angry": 0.20, "surprised": 0.22, "warm": 0.26,
    "teasing": 0.26, "belittling": 0.28, "judging": 0.30, "explaining": 0.28,
    "asking": 0.30, "desperate": 0.22, "neutral": 0.28, "touched": 0.34,
    "sad": 0.40,
}
DEFAULT_GAP = 0.26

# Delivery speed per emotion, as a tempo multiplier applied to the rendered
# audio (pitch-preserving). Gaps only control the space BETWEEN sentences; this
# is what stops her rushing inside one. Under 1.0 = slower. Excitement is
# allowed to be quick — that's the point of it — while anything reflective gets
# room to land.
RATE: dict[str, float] = {
    # anything commanding or high-energy keeps its full pace — slowing an order
    # down is what made it sound read-aloud rather than meant
    "excited": 1.0, "enthusiastic": 1.0, "greeting": 1.0, "angry": 1.0,
    "surprised": 0.97, "laughing": 0.97, "desperate": 0.98, "happy": 0.94,
    "teasing": 0.86, "belittling": 0.88, "warm": 0.88, "neutral": 0.89,
    "explaining": 0.88, "judging": 0.88, "asking": 0.88, "lecturing": 0.90,
    "touched": 0.85, "sad": 0.83,
}
DEFAULT_RATE = 0.88

# Pitch correction, as a multiplier on fundamental frequency.
#
# Her natural speaking pitch is ~275 Hz (measured off the teasing anchor). The
# happy and excited anchors are high-energy moments at 351 and 415 Hz, and
# cloning pushes them further still — 432 and 517 Hz measured, which is where
# the "inhaled helium" came from. These pull the bright registers back toward
# her own voice while leaving her normal range alone.
# Measured empirically: raw output lands at 330 Hz for happy against her own
# anchor's 351 Hz, i.e. already close. The earlier correction aimed at her
# NEUTRAL pitch (274 Hz) and so flattened the emotion out of the bright
# registers — she genuinely is higher when excited. Left off by default.
PITCH: dict[str, float] = {}
DEFAULT_PITCH = 1.0

# Registers where a question mark is nearly always rhetorical. Left as "?" the
# model lifts the final syllable, which turns a sarcastic jab into a genuine
# enquiry; swapping in a period makes the pitch fall the way sarcasm does.
SARCASTIC = {"teasing", "belittling", "judging", "lecturing"}

# Autoregressive TTS renders one- and two-word fragments badly — "Stop." on its
# own comes out clipped and robotic. Short sentences are merged with the next
# before synthesis so every chunk has room to sound like speech.
MIN_CHUNK = 28

_MOOD_RE = {m: [re.compile(p, re.I) for p in pats] for m, pats in MOOD_RULES.items()}


def split_speech(text: str) -> tuple[str, str]:
    """Separate what she SAYS from what the prose says ABOUT her.

    Her replies come in two shapes: narration with the dialogue in quotes, or
    plain speech with *action beats* between asterisks. Either way the prose is
    not spoken — it is the stage direction that decides how the line sounds.
    """
    quoted = re.findall(r'"([^"]{2,})"', text)
    if quoted:
        spoken = " ".join(q.strip() for q in quoted)
        descriptor = re.sub(r'"[^"]{2,}"', " ", text)
    else:
        spoken = re.sub(r"\*[^*]*\*", " ", text)
        descriptor = " ".join(re.findall(r"\*([^*]*)\*", text))
    tidy = lambda s: re.sub(r"\s+", " ", s).strip()
    return tidy(spoken)[:900], tidy(descriptor)[:900]


def chunk_sentences(spoken: str, mood: str) -> list[str]:
    """Split into synthesis units, then shape each for prosody.

    Two fixed rules, both about how the model reads punctuation:
      - fragments shorter than MIN_CHUNK are glued to the next sentence, since
        a lone "Stop." synthesizes as a clipped, robotic bark
      - in sarcastic registers a trailing "?" becomes "." so the line lands
        flat and dry instead of lifting like a real question
    """
    raw = [s.strip() for s in re.split(r"(?<=[.!?…])\s+", spoken) if s.strip()]
    merged: list[str] = []
    for s in raw:
        if merged and len(merged[-1]) < MIN_CHUNK:
            merged[-1] = f"{merged[-1]} {s}"
        else:
            merged.append(s)
    if len(merged) > 1 and len(merged[-1]) < MIN_CHUNK:
        tail = merged.pop()  # pop first: indexing after a pop in one statement misreads the list
        merged[-1] = f"{merged[-1]} {tail}"

    if mood in SARCASTIC:
        merged = [re.sub(r"\?(\s*)$", r".\1", s) for s in merged]
    return merged


def trim_lead(y, sr: int, max_trim: float = 0.45):
    """Drop a stray blip or breath before her first real word.

    The model sometimes opens on a half-syllable — the little bump at the top
    of a line. Same rule as the anchor trimmer: find the first sustained voiced
    run and start just before it, but never cut far enough to lose a word."""
    import numpy as np

    hop = int(sr * 0.02)
    if len(y) < hop * 4:
        return y
    frames = np.array([np.sqrt(np.mean(y[i:i + hop] ** 2)) for i in range(0, len(y) - hop, hop)])
    if not len(frames) or frames.max() <= 0:
        return y
    voiced = frames > frames.max() * 0.10
    run_start, run_len = 0, 0
    for i, v in enumerate(voiced):
        if v:
            if run_len == 0:
                run_start = i
            run_len += 1
            if run_len * 0.02 >= 0.18:  # a real word, not a tick
                cut = max(0.0, run_start * 0.02 - 0.06)
                return y[int(min(cut, max_trim) * sr):] if cut > 0.02 else y
        else:
            run_len = 0
    return y


def pick_mood(spoken: str, descriptor: str) -> str:
    """Score the stage direction against the rule table. No model involved."""
    best, best_score = DEFAULT_MOOD, 0.0
    for mood, pats in _MOOD_RE.items():
        score = 0.0
        for p in pats:
            if p.search(descriptor):
                score += 3.0
            if p.search(spoken):
                score += 1.0
        if score > best_score:
            best, best_score = mood, score
    if best_score == 0 and spoken.count("!") >= 2:
        return "excited"
    return best


def pick_nonverbal(descriptor: str) -> str:
    """Which of her real sounds, if any, this line should open with."""
    lib = load_nonverbal()
    for tag, pats in _NONVERBAL_RE.items():
        if tag in lib and any(p.search(descriptor) for p in pats):
            return tag
    return ""


def _finish_voice(voice_id: str, samples, sr: int) -> None:
    _finished[voice_id] = (samples, sr)
    while len(_finished) > 8:
        _finished.pop(next(iter(_finished)))


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):  # quiet
        pass

    def _json(self, code: int, obj: dict) -> None:
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            b = load_backend()
            self._json(200, {"ok": True, "backend": b.NAME,
                             "loaded": getattr(b, "_vc", None) is not None
                                       or getattr(b, "_model", None) is not None,
                             "emotions": sorted(load_emotions().keys())})
            return
        if self.path.startswith("/rest/"):
            job = _rest_jobs.pop(self.path.split("/rest/", 1)[1], None)
            if not job:
                self.send_response(404)
                self.end_headers()
                return
            job["event"].wait(timeout=600)
            data = job.get("wav")
            if not data:
                self.send_response(204)
                self.end_headers()
                return
            self.send_response(200)
            self.send_header("content-type", "audio/wav")
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        if self.path == "/keep":
            self._keep()
            return
        if self.path != "/speak":
            self.send_response(404)
            self.end_headers()
            return
        try:
            self._speak()
        except Exception as e:
            self._json(500, {"error": str(e)[:300]})

    def _keep(self) -> None:
        """Playback finished uninterrupted → archive it, named by her words."""
        try:
            import soundfile as sf

            n = int(self.headers.get("content-length", 0))
            req = json.loads(self.rfile.read(n) or b"{}")
            got = _finished.pop(str(req.get("voice_id", "")), None)
            if got:
                spoken, _ = split_speech(str(req.get("text", "")))
                safe = re.sub(r"[^\w \-']", "", spoken)[:60].strip() or "line"
                SPOKEN.mkdir(parents=True, exist_ok=True)
                sf.write(SPOKEN / f"{safe}.wav", got[0], got[1])
            self._json(200, {"kept": bool(got)})
        except Exception as e:
            self._json(500, {"error": str(e)[:200]})

    def _speak(self) -> None:
        import numpy as np
        import soundfile as sf

        n = int(self.headers.get("content-length", 0))
        req = json.loads(self.rfile.read(n) or b"{}")
        raw = str(req.get("text", ""))
        spoken, descriptor = split_speech(raw)
        if not spoken:
            raise ValueError("nothing to say")

        # an explicit mood wins; otherwise her own stage direction decides
        mood = str(req.get("mood") or "").strip() or pick_mood(spoken, descriptor)

        # laughter leads with the real clip, then she talks normally
        detected = mood
        laughs = mood == LAUGH_ANCHOR and LAUGH_ANCHOR in load_emotions()
        if laughs:
            mood = LAUGH_SPEECH_MOOD
        # a sigh/chuckle/noticing sound can lead any register, laughter aside
        lead_sound = "" if laughs else pick_nonverbal(descriptor)

        reported = detected
        gap = PACING.get(mood, DEFAULT_GAP)
        rate = RATE.get(mood, DEFAULT_RATE)
        pitch = PITCH.get(mood, DEFAULT_PITCH)

        # The backend name belongs in the key. The same line through RVC and
        # through Qwen are two different recordings, and without it whichever
        # rendered first would be served for both.
        backend = load_backend()
        cache_key = hashlib.sha1(
            f"{backend.NAME}|{mood}|{spoken}".encode()).hexdigest()[:16]
        CACHE.mkdir(parents=True, exist_ok=True)
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
            self.send_header("x-voice-mood", reported)
            self.send_header("x-voice-cached", "1")
            self.end_headers()
            self.wfile.write(data)
            return

        def synth_raw(t: str):
            """One sentence; retry once so a hiccup never eats part of a line.

            Serialized: RVC chdir's into its own tree and neither backend is
            safe to run twice at once."""
            last = None
            for _ in range(2):
                try:
                    with _backend_lock:
                        return backend.synth(t, mood)
                except Exception as e:
                    last = e
            raise last

        def shape(s, sr: int):
            """Pitch and tempo in one ffmpeg pass.

            Pitch is shifted by resampling (asetrate) and the resulting speed
            change is undone with atempo — cheaper and cleaner on speech than a
            phase-vocoder pitch shift, which is what made things sound robotic
            before. Any failure returns the audio untouched.

            The rate is the BACKEND'S, passed in rather than assumed: Qwen
            returns 24 kHz and RVC 40 kHz, and hardcoding either one transposes
            the other by the ratio between them — a major sixth, in that case."""
            if abs(pitch - 1.0) < 0.005 and abs(rate - 1.0) < 0.005:
                return s
            try:
                import subprocess
                import tempfile

                import soundfile as sf2

                # asetrate moves pitch AND speed by `pitch`; atempo restores the
                # speed and then applies the register's own tempo on top
                tempo = rate / pitch
                chain = [f"asetrate={sr}*{pitch:.4f}", f"aresample={sr}"]
                while tempo > 2.0:   # atempo only accepts 0.5-2.0 per stage
                    chain.append("atempo=2.0")
                    tempo /= 2.0
                while tempo < 0.5:
                    chain.append("atempo=0.5")
                    tempo /= 0.5
                chain.append(f"atempo={tempo:.4f}")

                with tempfile.TemporaryDirectory() as td:
                    src, dst = Path(td) / "i.wav", Path(td) / "o.wav"
                    sf2.write(src, np.asarray(s, dtype="float32"), sr)
                    subprocess.run([FFMPEG, "-y", "-v", "error", "-i", str(src),
                                    "-filter:a", ",".join(chain), str(dst)],
                                   check=True, timeout=60)
                    y, _ = sf2.read(dst)
                    return np.asarray(y, dtype="float32")
            except Exception:
                return s

        def render(parts):
            """Sentence-by-sentence: short inputs keep her pacing natural and
            can't drop tails. Gap and tempo both come from the emotion."""
            chunks, sr = [], getattr(backend, "SR_HINT", 24000)
            for p in parts:
                if not p.strip():
                    continue
                s, sr = synth_raw(p.strip())
                s = shape(trim_lead(np.asarray(s, dtype="float32"), sr), sr)
                chunks.append(s)
                chunks.append(np.zeros(int(sr * gap), dtype=s.dtype))
            joined = np.concatenate(chunks) if chunks else np.zeros(1, dtype="float32")
            buf = io.BytesIO()
            sf.write(buf, joined, sr, format="WAV")
            return buf.getvalue(), joined, sr

        def real_sound(path: Path, speech, sr: int, max_sec: float, gap: float):
            """One of her actual recordings, untouched — no cloning, no stretch.

            Resampled to the speech it will sit in front of. Her clips were cut
            at whatever rate the episode had; splicing them onto 40 kHz output
            without reconciling the two plays them fast and sharp.

            Level-matched too: a real recording sitting noticeably louder than
            the synthesis makes the synthesis sound robotic by contrast, even
            when it's fine on its own."""
            y, lsr = sf.read(path)
            y = np.asarray(y, dtype="float32")
            if y.ndim > 1:
                y = y.mean(axis=1)
            y = y[: int(lsr * max_sec)]

            if lsr != sr and len(y):
                n = int(round(len(y) * sr / lsr))
                y = np.interp(np.linspace(0, len(y) - 1, n),
                              np.arange(len(y)), y).astype("float32")

            lr, sr_ = float(np.sqrt(np.mean(y**2))), float(np.sqrt(np.mean(np.asarray(speech) ** 2)))
            if lr > 1e-6 and sr_ > 1e-6:
                y *= min(3.0, max(0.33, sr_ / lr))

            fade = int(sr * 0.12)  # don't cut it off mid-breath
            if len(y) > fade:
                y[-fade:] *= np.linspace(1.0, 0.0, fade)
            return np.concatenate([y, np.zeros(int(sr * gap), dtype="float32")])

        sentences = chunk_sentences(spoken, mood)
        first_wav, first_samples, sr0 = render(sentences[:1])

        lead = None
        if laughs:
            lead = (path_of(load_emotions()[LAUGH_ANCHOR]), LAUGH_MAX, LAUGH_GAP)
        elif lead_sound:
            lead = (path_of(load_nonverbal()[lead_sound]), NONVERBAL_MAX, NONVERBAL_GAP)
        if lead:
            first_samples = np.asarray(first_samples, dtype="float32")
            first_samples = np.concatenate(
                [real_sound(lead[0], first_samples, sr0, lead[1], lead[2]), first_samples])
            buf = io.BytesIO()
            sf.write(buf, first_samples, sr0, format="WAV")
            first_wav = buf.getvalue()

        job_id = ""
        if len(sentences) > 1:
            job_id = uuid.uuid4().hex[:12]
            job = {"event": threading.Event(), "wav": None}
            _rest_jobs[job_id] = job

            def bg():
                try:
                    wav, samples, sr = render(sentences[1:])
                    job["wav"] = wav
                    full = np.concatenate([first_samples, samples])
                    _finish_voice(voice_id, full, sr)
                    try:
                        sf.write(cached, full, sr)
                    except Exception:
                        pass
                finally:
                    job["event"].set()

            threading.Thread(target=bg, daemon=True).start()
        else:
            _finish_voice(voice_id, first_samples, sr0)
            try:
                sf.write(cached, first_samples, sr0)
            except Exception:
                pass

        self.send_response(200)
        self.send_header("content-type", "audio/wav")
        self.send_header("content-length", str(len(first_wav)))
        self.send_header("x-voice-id", voice_id)
        self.send_header("x-voice-mood", reported)
        if job_id:
            self.send_header("x-voice-rest", job_id)
        self.end_headers()
        self.wfile.write(first_wav)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Beni voice server")
    ap.add_argument("--backend", default="rvc", choices=["rvc", "qwen"],
                    help="rvc (default, fast) or qwen (dormant, slower)")
    ap.add_argument("--warm", action="store_true",
                    help="load the model at startup instead of on the first line")
    args = ap.parse_args()

    # Config in the RVC tree parses sys.argv itself and rejects flags it does
    # not own, so our own arguments must be out of the way before it loads.
    backend = load_backend(args.backend)
    sys.argv = sys.argv[:1]

    SPOKEN.mkdir(parents=True, exist_ok=True)
    CACHE.mkdir(parents=True, exist_ok=True)

    print(f"Beni voice on :{PORT}  backend={backend.NAME}  "
          f"({len(load_emotions())} emotion anchors)")
    if args.warm:
        backend.load()
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()

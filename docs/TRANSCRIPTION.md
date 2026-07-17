# Episode transcription — the slot

Everything here activates the moment episode files exist in `data/episodes/`. How you obtain them
is up to you (the series streams free on some regional services and is purchasable digitally —
availability varies by country). The pipeline never asks where files came from.

## What you get

`data/transcripts/epNN.json` — every line of dialogue, speaker-labeled:

```json
{ "episode": 14, "lines": [ { "speaker": "Beni", "text": "Did you miss me?", "t0": 512.3, "t1": 513.9 } ] }
```

`npm run ingest` then indexes them as premium canon (episode-capped like everything else), and
`npm run export-lora` turns Beni's lines into LoRA training data.

## One-time setup

```powershell
winget install Gyan.FFmpeg
cd pipeline\transcribe
python -m venv .venv && .venv\Scripts\activate
pip install torch --index-url https://download.pytorch.org/whl/cu124
pip install -r requirements.txt
# free HF token, accept terms at huggingface.co/pyannote/speaker-diarization-3.1
setx HF_TOKEN hf_your_token
```

## The flow

```powershell
# 1. drop files into data\episodes\  (any name containing the episode number, e.g. "Tenkai Knights - 14.mkv")
python transcribe.py          # Whisper large-v3 on your GPU (~2-3 min/ep). If .srt/.vtt subs sit
                              # next to the media, they're used instead — perfect text, zero ASR errors.
python diarize_match.py       # splits voices per episode
```

**First episode only** — label the voices once (~2 minutes of listening):

```powershell
# clips were exported to review\ep14\ — listen in Explorer, then e.g.:
python enroll.py --episode 14 SPEAKER_00=Beni SPEAKER_01=Guren SPEAKER_02=Ceylan SPEAKER_03=Gen
python diarize_match.py       # now auto-labels this and every future episode
cd ..\.. && npm run ingest
```

Enroll from 2–3 different episodes (same command) to make profiles sturdier. Nika Futterman's
Beni voice is distinctive — her cluster matches reliably.

## Accuracy tips

- Dub audio + English Whisper large-v3 ≈ near-perfect text for a clean TV mix.
- Crosstalk/action scenes: diarization sometimes merges speakers; those lines land as
  `UNKNOWN(...)` rather than mislabeled — they still ingest as scene context, and the LoRA
  exporter only uses confident `Beni` lines.
- Re-running is safe and incremental: work files cache in `pipeline/transcribe/work/`.

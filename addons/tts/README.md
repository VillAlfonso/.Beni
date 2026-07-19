# Beni voice addon (Qwen3-TTS, fully local)

Decoupled from the app: own venv, own port (5002). The app only ever talks to
`POST /speak` via its `/api/tts` proxy; without this addon running, the app is
simply voiceless.

## One-time setup (what was done, reproducibly)

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install torch --index-url https://download.pytorch.org/whl/cu128
.venv\Scripts\python -m pip install -U qwen-tts soundfile accelerate datasets transformers bitsandbytes
git clone --depth 1 https://github.com/QwenLM/Qwen3-TTS.git qwen-repo
```

**Two required patches to `qwen-repo/finetuning/sft_12hz.py` (and prepare_data.py):**
1. `flash_attention_2` → `sdpa` everywhere (no FlashAttention wheels on Windows; sdpa is
   mathematically identical).
2. `from torch.optim import AdamW` → `from bitsandbytes.optim import AdamW8bit as AdamW`
   (8-bit optimizer states ≈ 4× smaller → the 1.7B full fine-tune fits in 16 GB VRAM).

Note: the finetuning scripts assume the **1.7B** architecture (2048-dim); the 0.6B crashes
with a 2048-vs-1024 shape error. Train the 1.7B.

## Dataset (already built)

- `build_dataset.py` — cuts every confidently-Beni line (24 kHz mono, vocal-isolated via
  demucs where available) → `dataset/wavs/` + `dataset/metadata.jsonl` + `dataset/refs/`.
  Current: 235 clips / 20.6 min / 222 clean.
- `make_manifest.py` — converts to Qwen's format (`train_raw.jsonl`, single shared
  ref_audio for speaker consistency).

## Train (GPU; stop KoboldCpp first)

```powershell
cd qwen-repo\finetuning
..\..\.venv\Scripts\python prepare_data.py --device cuda:0 --tokenizer_model_path Qwen/Qwen3-TTS-Tokenizer-12Hz --input_jsonl ..\..\train_raw.jsonl --output_jsonl ..\..\train_with_codes.jsonl
..\..\.venv\Scripts\python sft_12hz.py --init_model_path Qwen/Qwen3-TTS-12Hz-1.7B-Base --output_model_path ..\..\output-1.7b --train_jsonl ..\..\train_with_codes.jsonl --batch_size 2 --lr 2e-6 --num_epochs 10 --speaker_name beni
```

## Serve

`config.json`: `{"checkpoint": "output-1.7b/checkpoint-epoch-N"}` (or it auto-picks the
newest). Then `Beni-voice.bat` (repo root) → server on :5002 → the 🔊 button appears on her
messages, with mood-aware `instruct` derived from her prose (cold / angry / soft / scared /
bored / teasing / default sass).

## VRAM reality

Her 24B brain (~14.5 GB) and the 1.7B voice (~4 GB) cannot share the 16 GB card at once.
Options: run voice on CPU (slower per line), or a reduced-context Kobold profile during
voice sessions. Benchmark before choosing.

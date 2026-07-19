#!/usr/bin/env bash
# Full voice fine-tune, start to finish. Needs the GPU to itself.
#
# The last run drifted by epoch 9 — the voice was there but the sass wasn't — so
# this stops at 6 and keeps every checkpoint, letting the best one be picked by
# ear rather than by assuming more epochs is better.
set -e

cd "$(dirname "$0")"
ADDON="$(pwd)"
PY="$ADDON/.venv/Scripts/python.exe"
OUT="$ADDON/output-1.7b-v2"

echo "=== 1/3  manifest ==="
"$PY" make_manifest.py

echo
echo "=== 2/3  encoding audio to codec tokens (GPU) ==="
cd "$ADDON/qwen-repo/finetuning"
"$PY" prepare_data.py \
  --device cuda:0 \
  --tokenizer_model_path Qwen/Qwen3-TTS-Tokenizer-12Hz \
  --input_jsonl "$ADDON/train_raw.jsonl" \
  --output_jsonl "$ADDON/train_with_codes.jsonl"

echo
echo "=== 3/3  fine-tuning 1.7B ==="
"$PY" sft_12hz.py \
  --init_model_path "$ADDON/models/1.7B-Base" \
  --output_model_path "$OUT" \
  --train_jsonl "$ADDON/train_with_codes.jsonl" \
  --batch_size 2 \
  --lr 2e-6 \
  --num_epochs 6 \
  --speaker_name beni

echo
echo "DONE -> $OUT"
ls -1 "$OUT" 2>/dev/null || true

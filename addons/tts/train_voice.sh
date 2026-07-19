#!/usr/bin/env bash
# Full voice fine-tune, start to finish. Needs the GPU to itself.
#
# Run history:
#   v1  10 epochs @ 2e-6 -> loss 13.9 -> 7.8. Timbre landed, prosody didn't.
#   v2   6 epochs @ 2e-6 -> loss  8.7 -> 8.0. Barely moved; measured flatter
#        than her real clips (pitch spread 56 Hz vs her 79 Hz). Undertrained.
#   v3  this run: 16 epochs @ 1e-5, which is 5x the learning rate and ~2.5x the
#        steps of v2. If prosody is recoverable from 20 minutes of audio at all,
#        this should show it; if v3 is still flat, the dataset is the limit and
#        no schedule fixes that.
#
# Every epoch is checkpointed, so overshoot is recoverable — pick by ear.
set -e

cd "$(dirname "$0")"
ADDON="$(pwd)"
PY="$ADDON/.venv/Scripts/python.exe"
OUT="$ADDON/output-1.7b-v3"

EPOCHS="${EPOCHS:-16}"
LR="${LR:-1e-5}"

echo "=== 1/3  manifest ==="
"$PY" make_manifest.py

echo
echo "=== 2/3  encoding audio to codec tokens (GPU) ==="
cd "$ADDON/qwen-repo/finetuning"
if [ -f "$ADDON/train_with_codes.jsonl" ]; then
  echo "codes already encoded, reusing"
else
  "$PY" prepare_data.py \
    --device cuda:0 \
    --tokenizer_model_path Qwen/Qwen3-TTS-Tokenizer-12Hz \
    --input_jsonl "$ADDON/train_raw.jsonl" \
    --output_jsonl "$ADDON/train_with_codes.jsonl"
fi

echo
echo "=== 3/3  fine-tuning 1.7B  (${EPOCHS} epochs @ lr ${LR}) ==="
"$PY" sft_12hz.py \
  --init_model_path "$ADDON/models/1.7B-Base" \
  --output_model_path "$OUT" \
  --train_jsonl "$ADDON/train_with_codes.jsonl" \
  --batch_size 2 \
  --lr "$LR" \
  --num_epochs "$EPOCHS" \
  --speaker_name beni

echo
echo "DONE -> $OUT"
ls -1 "$OUT" 2>/dev/null || true

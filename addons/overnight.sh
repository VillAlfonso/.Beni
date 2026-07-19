#!/usr/bin/env bash
# Unattended chain, in order:
#
#   1. wait for the running Qwen fine-tune (v3) to exit
#   2. render the Qwen emotional sweep across its checkpoints
#   3. train GPT-SoVITS on the same dataset
#   4. render the GPT-SoVITS emotional sweep across ITS checkpoints
#
# Steps are independent: if one fails the log says so and the chain carries on
# to the next, because a failed Qwen sweep shouldn't cost a night of SoVITS
# training. Nothing here needs a human.
#
# Run: bash overnight.sh   (log: addons/overnight.log)
set -u

ADDONS="$(cd "$(dirname "$0")" && pwd)"
TTS="$ADDONS/tts"
SOV="$ADDONS/sovits"
LOG="$ADDONS/overnight.log"

say() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }

say "=== overnight chain starting ==="

# ---- 1. wait for the Qwen run --------------------------------------------
say "waiting for the Qwen fine-tune to finish…"
# PowerShell rather than wmic/tasklist: wmic is deprecated and its output is
# unreliable under Git Bash, and a false "done" here would start SoVITS while
# the GPU is still full
qwen_running() {
  powershell.exe -NoProfile -Command \
    "if (Get-CimInstance Win32_Process -Filter \"Name like '%python%'\" | Where-Object { \$_.CommandLine -like '*sft_12hz*' }) { 'RUNNING' } else { 'DONE' }" 2>/dev/null | tr -d '\r\n'
}
while [ "$(qwen_running)" = "RUNNING" ]; do
  sleep 60
done
say "Qwen fine-tune no longer running"
sleep 20   # let the GPU drain

# ---- 2. Qwen emotional sweep ---------------------------------------------
if ls -d "$TTS"/output-1.7b-v3/checkpoint-* >/dev/null 2>&1; then
  say "rendering Qwen emotional sweep (v3 checkpoints)…"
  ( cd "$TTS" && sed 's|output-1.7b-v2|output-1.7b-v3|' compare_epochs.py > compare_epochs_v3.py \
    && ./.venv/Scripts/python.exe compare_epochs_v3.py ) >>"$LOG" 2>&1 \
    && say "Qwen sweep done -> tts/out/epochs/" \
    || say "Qwen sweep FAILED (continuing)"
else
  say "no v3 checkpoints found, skipping Qwen sweep"
fi

# ---- 3. GPT-SoVITS training ----------------------------------------------
say "starting GPT-SoVITS training…"
if ( cd "$SOV" && ./.venv/Scripts/python.exe train_beni.py ) >>"$LOG" 2>&1; then
  say "GPT-SoVITS training done"
else
  say "GPT-SoVITS training FAILED — see log above"
fi

# ---- 4. GPT-SoVITS emotional sweep ---------------------------------------
if ls "$SOV"/GPT_weights/*.ckpt >/dev/null 2>&1; then
  say "rendering GPT-SoVITS emotional sweep…"
  ( cd "$SOV" && ./.venv/Scripts/python.exe compare_epochs_sovits.py ) >>"$LOG" 2>&1 \
    && say "SoVITS sweep done -> tts/out/sovits-epochs/" \
    || say "SoVITS sweep FAILED"
else
  say "no GPT-SoVITS checkpoints, skipping sweep"
fi

say "=== chain complete ==="
say "listen: tts/out/epochs/ (Qwen)  and  tts/out/sovits-epochs/ (GPT-SoVITS)"

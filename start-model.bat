@echo off
title Beni - Model (KoboldCpp / Cydonia 24B)
cd /d "%~dp0"
echo Loading Cydonia 24B v4.3 fully onto the GPU (takes ~30-60s)...
tools\koboldcpp.exe --model models\TheDrummer_Cydonia-24B-v4.3-IQ4_XS.gguf --usecublas normal --gpulayers 999 --contextsize 16384 --flashattention --quantkv 1 --port 5001
pause

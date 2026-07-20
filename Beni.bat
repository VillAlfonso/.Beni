@echo off
rem ============================================================
rem  BENI — the everyday stack. Her, with her voice:
rem    1. Model  (KoboldCpp / Cydonia 24B on the GPU)
rem    2. Voice  (RVC — Windows SAPI read through her model, :5002)
rem    3. App    (http://localhost:3001)
rem    4. Tunnel (https://beni.quert.site)
rem  Close a window to stop that piece. Run this again anytime.
rem
rem  The voice costs almost nothing here. RVC is three feed-forward passes
rem  over a few seconds of audio — about 1.5 GB of VRAM and roughly 0.8s a
rem  line, against the 14.3s the old autoregressive setup needed. It takes
rem  the GPU when there's room and falls back to CPU when there isn't.
rem
rem  Use Beni-voice.bat if you want Qwen3-TTS instead. That one is slower
rem  and wants the card to itself.
rem
rem  NOTE: use start's /d switch for the working directory. Wrapping a
rem  cd inside cmd /k "..." nests double quotes, which cmd mis-parses and
rem  the window closes instantly.
rem ============================================================
cd /d "%~dp0"
start "Beni - Model" cmd /k tools\koboldcpp.exe --model models\TheDrummer_Cydonia-24B-v4.3-IQ4_XS.gguf --usecublas normal --gpulayers 999 --contextsize 16384 --flashattention --quantkv 1 --port 5001
start "Beni - Voice" /d "%~dp0voice" cmd /k ..\voice-runtime\.venv\Scripts\python.exe server.py --backend rvc
start "Beni - App" cmd /k npm start
start "Beni - Tunnel" cmd /k tools\cloudflared.exe tunnel --config "%USERPROFILE%\.cloudflared\beni-config.yml" run beni
echo.
echo  Four windows opened: Model / Voice / App / Tunnel.
echo    On this PC:    http://localhost:3001   (model ready in ~60s)
echo    On your phone: https://beni.quert.site
echo.
echo  Don't run the model window during episode transcription batches
echo  (both need the GPU).
timeout /t 12

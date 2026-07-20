@echo off
rem ============================================================
rem  BENI + QWEN VOICE — the slow, dormant voice.
rem    1. Model  (KoboldCpp / Cydonia 24B on the GPU)
rem    2. Voice  (Qwen3-TTS clone mode on her anchor library, :5002)
rem    3. App    (http://localhost:3001)
rem    4. Tunnel (https://beni.quert.site)
rem  Close a window to stop that piece. Run again anytime.
rem
rem  Beni.bat is the one you want. This exists so the cloning path stays
rem  reachable — it clones her timbre from her own clips rather than
rem  converting a source voice, which is better in places and much slower:
rem  ~14.3s to a first sentence against RVC's ~0.8s.
rem
rem  Both on one 16 GB card means the 24B takes the GPU (~14.5 GB) and this
rem  runs on CPU, so the first line of a message takes a few seconds.
rem  Replaying anything already spoken is instant either way (it's cached).
rem
rem  This is the ONLY thing that still needs addons\. Delete that folder and
rem  you lose this launcher and nothing else — Beni.bat resolves entirely
rem  within voice\, voice-runtime\ and data\.
rem
rem  NOTE: use start's /d switch for the working directory. Wrapping a
rem  cd inside cmd /k "..." nests double quotes, which cmd mis-parses and
rem  the window closes instantly.
rem ============================================================
cd /d "%~dp0"
start "Beni - Model" /d "%~dp0" cmd /k tools\koboldcpp.exe --model models\TheDrummer_Cydonia-24B-v4.3-IQ4_XS.gguf --usecublas normal --gpulayers 999 --contextsize 16384 --flashattention --quantkv 1 --port 5001
start "Beni - Voice" /d "%~dp0voice" cmd /k ..\addons\tts\.venv\Scripts\python.exe server.py --backend qwen
start "Beni - App" /d "%~dp0" cmd /k npm start
start "Beni - Tunnel" /d "%~dp0" cmd /k tools\cloudflared.exe tunnel --config "%USERPROFILE%\.cloudflared\beni-config.yml" run beni
echo.
echo  Four windows opened: Model / Voice (Qwen) / App / Tunnel.
echo    On this PC:    http://localhost:3001   (model ready in ~60s)
echo    On your phone: https://beni.quert.site
echo.
timeout /t 12

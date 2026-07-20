@echo off
rem ============================================================
rem  BENI + VOICE — the full stack. Everything she has.
rem    1. Model  (KoboldCpp / Cydonia 24B on the GPU)
rem    2. Voice  (Qwen3-TTS clone mode on her anchor library, :5002)
rem    3. App    (http://localhost:3001)
rem    4. Tunnel (https://beni.quert.site)
rem  Close a window to stop that piece. Run again anytime.
rem
rem  Use Beni.bat instead when you want her without the voice — the model
rem  alone leaves the card far less loaded.
rem
rem  Both on one 16 GB card means the 24B takes the GPU (~14.5 GB) and the
rem  voice runs on CPU, so the first line of a message takes a few seconds.
rem  Replaying anything already spoken is instant either way (it's cached).
rem
rem  NOTE: use start's /d switch for the working directory. Wrapping a
rem  cd inside cmd /k "..." nests double quotes, which cmd mis-parses and
rem  the window closes instantly.
rem ============================================================
cd /d "%~dp0"
start "Beni - Model" /d "%~dp0" cmd /k tools\koboldcpp.exe --model models\TheDrummer_Cydonia-24B-v4.3-IQ4_XS.gguf --usecublas normal --gpulayers 999 --contextsize 16384 --flashattention --quantkv 1 --port 5001
start "Beni - Voice" /d "%~dp0addons\tts" cmd /k .venv\Scripts\python.exe server.py
start "Beni - App" /d "%~dp0" cmd /k npm start
start "Beni - Tunnel" /d "%~dp0" cmd /k tools\cloudflared.exe tunnel --config "%USERPROFILE%\.cloudflared\beni-config.yml" run beni
echo.
echo  Four windows opened: Model / Voice / App / Tunnel.
echo    On this PC:    http://localhost:3001   (model ready in ~60s)
echo    On your phone: https://beni.quert.site
echo.
timeout /t 12

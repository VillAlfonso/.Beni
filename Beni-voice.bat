@echo off
rem ============================================================
rem  BENI VOICE — everything except the local 24B model.
rem    1. Voice  (Qwen3-TTS clone mode on her anchor library, :5002)
rem    2. App    (http://localhost:3001)
rem    3. Tunnel (https://beni.quert.site)
rem  Close a window to stop that piece. Run again anytime.
rem
rem  Use Beni.bat instead if you also want the 24B on the GPU.
rem  Running both is fine — the voice falls back to CPU when the model
rem  owns the card, which costs a few seconds per line.
rem
rem  NOTE: use start's /d switch for the working directory. Wrapping a
rem  cd inside cmd /k "..." nests double quotes, which cmd mis-parses and
rem  the window closes instantly.
rem ============================================================
cd /d "%~dp0"
start "Beni - Voice" /d "%~dp0addons\tts" cmd /k .venv\Scripts\python.exe server.py
start "Beni - App" /d "%~dp0" cmd /k npm start
start "Beni - Tunnel" /d "%~dp0" cmd /k tools\cloudflared.exe tunnel --config "%USERPROFILE%\.cloudflared\beni-config.yml" run beni
echo.
echo  Three windows opened: Voice / App / Tunnel.
echo    On this PC:    http://localhost:3001
echo    On your phone: https://beni.quert.site
echo.
timeout /t 8

@echo off
rem ============================================================
rem  BENI VOICE — her voice plus the app, without the local model.
rem    1. Voice  (Qwen3-TTS clone mode on her anchor library, :5002)
rem    2. App    (http://localhost:3001)
rem  Close a window to stop that piece. Run again anytime.
rem
rem  Use Beni.bat instead if you also want the 24B model on the GPU.
rem  Running both is fine — the voice falls back to CPU when the model
rem  owns the card, which costs a few seconds per line.
rem ============================================================
cd /d "%~dp0"
start "Beni - Voice" cmd /k "cd /d "%~dp0addons\tts" && .venv\Scripts\python.exe server.py"
start "Beni - App" cmd /k npm start
echo.
echo  Two windows opened: Voice / App.
echo    On this PC:  http://localhost:3001
echo    The speaker button appears on her messages once Voice is up.
echo.
timeout /t 8

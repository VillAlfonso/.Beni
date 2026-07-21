@echo off
rem ============================================================
rem  BENI (RVC voice) -- fast, dormant fallback.
rem  RVC timbre-swaps a Windows voice in about 0.8 seconds, but GPT-SoVITS
rem  is the everyday option because it is markedly more natural.
rem ============================================================
cd /d "%~dp0"
start "Beni - Model" /d "%~dp0" cmd /k tools\koboldcpp.exe --model models\TheDrummer_Cydonia-24B-v4.3-IQ4_XS.gguf --usecublas normal --gpulayers 999 --contextsize 16384 --flashattention --quantkv 1 --port 5001
start "Beni - Voice (RVC)" /d "%~dp0voice" cmd /k ..\voice-runtime\.venv\Scripts\python.exe server.py --backend rvc
start "Beni - App" /d "%~dp0" cmd /k npm start
start "Beni - Tunnel" /d "%~dp0" cmd /k tools\cloudflared.exe tunnel --config "%USERPROFILE%\.cloudflared\beni-config.yml" run beni
echo.
echo  Four windows opened: Model / Voice (RVC) / App / Tunnel.
timeout /t 12

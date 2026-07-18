@echo off
rem ============================================================
rem  BENI — one button. Starts everything she needs:
rem    1. Model  (KoboldCpp / Cydonia 24B on the GPU)
rem    2. App    (http://localhost:3001)
rem    3. Tunnel (https://beni.quert.site)
rem  Close a window to stop that piece. Run this again anytime.
rem ============================================================
cd /d "%~dp0"
start "Beni - Model" cmd /k tools\koboldcpp.exe --model models\TheDrummer_Cydonia-24B-v4.3-IQ4_XS.gguf --usecublas normal --gpulayers 999 --contextsize 16384 --flashattention --quantkv 1 --port 5001
start "Beni - App" cmd /k npm start
start "Beni - Tunnel" cmd /k tools\cloudflared.exe tunnel --config "%USERPROFILE%\.cloudflared\beni-config.yml" run beni
echo.
echo  Three windows opened: Model / App / Tunnel.
echo    On this PC:    http://localhost:3001   (model ready in ~60s)
echo    On your phone: https://beni.quert.site
echo.
echo  Don't run the model window during episode transcription batches
echo  (both need the GPU).
timeout /t 12

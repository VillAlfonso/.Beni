@echo off
rem ============================================================
rem  BENI (LOCAL ONLY) — starts her on this PC, no internet tunnel:
rem    1. Model  (KoboldCpp / Cydonia 24B on the GPU)
rem    2. App    (http://localhost:3001)
rem  Use Beni.bat instead when you want phone access
rem  (it adds the https://beni.quert.site tunnel window).
rem ============================================================
cd /d "%~dp0"
start "Beni - Model" cmd /k tools\koboldcpp.exe --model models\TheDrummer_Cydonia-24B-v4.3-IQ4_XS.gguf --usecublas normal --gpulayers 999 --contextsize 16384 --flashattention --quantkv 1 --port 5001
start "Beni - App" cmd /k npm start
echo.
echo  Two windows opened: Model / App.
echo    This PC only:  http://localhost:3001   (model ready in ~60s)
echo    No tunnel — she is NOT reachable from your phone in this mode.
echo.
timeout /t 12

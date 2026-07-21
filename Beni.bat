@echo off
rem ============================================================
rem  BENI -- the everyday stack:
rem    1. Model  (KoboldCpp / Cydonia 24B on the GPU)
rem    2. Voice  (GPT-SoVITS v2, tone-matched Beni references, :5002)
rem    3. App    (http://localhost:3001)
rem    4. Tunnel (https://beni.quert.site)
rem
rem  After GPT-SoVITS has loaded, it starts speaking with the first completed
rem  sentence: about 1.6 seconds when the GPU is available, about 3.2 seconds
rem  when Cydonia owns the card and voice runs on CPU. Longer replies stream
rem  sentence by sentence and are not truncated.
rem
rem  Use Beni-rvc.bat only for the fast, less-natural RVC fallback.
rem ============================================================
cd /d "%~dp0"
start "Beni - Model" /d "%~dp0" cmd /k tools\koboldcpp.exe --model models\TheDrummer_Cydonia-24B-v4.3-IQ4_XS.gguf --usecublas normal --gpulayers 999 --contextsize 16384 --flashattention --quantkv 1 --port 5001
start "Beni - Voice" /d "%~dp0voice" cmd /k ..\voice-runtime\gptsovits\.venv\Scripts\python.exe server.py --backend gptsovits
start "Beni - App" /d "%~dp0" cmd /k npm start
start "Beni - Tunnel" /d "%~dp0" cmd /k tools\cloudflared.exe tunnel --config "%USERPROFILE%\.cloudflared\beni-config.yml" run beni
echo.
echo  Four windows opened: Model / Voice / App / Tunnel.
echo    On this PC:    http://localhost:3001   (model ready in ~60s)
echo    On your phone: https://beni.quert.site
echo.
echo  Don't run the model window during episode transcription batches
echo  (both need the GPU).
timeout /t 12

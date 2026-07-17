@echo off
cd /d "%~dp0"
start "Beni - Model" start-model.bat
start "Beni - App" start-app.bat
start "Beni - Tunnel" start-tunnel.bat
echo.
echo Three windows opened: Model (KoboldCpp), App, Tunnel.
echo Local:  http://localhost:3001  (wait ~60s for the model to finish loading)
echo Phone:  the https URL shown in the Tunnel window.
echo Close a window to stop that piece.
timeout /t 15

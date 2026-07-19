@echo off
rem  BENI VOICE — the standalone TTS server (Qwen3-TTS fine-tuned on her).
rem  Optional addon: run alongside Beni.bat; the speaker button appears on
rem  her messages once this is up. Close the window to go silent.
cd /d "%~dp0addons\tts"
start "Beni - Voice" cmd /k .venv\Scripts\python.exe server.py

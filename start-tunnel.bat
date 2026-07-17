@echo off
title Beni - Tunnel
cd /d "%~dp0"
if exist "%USERPROFILE%\.cloudflared\beni-config.yml" (
  echo Permanent tunnel: https://beni.quert.site
  tools\cloudflared.exe tunnel --config "%USERPROFILE%\.cloudflared\beni-config.yml" run beni
) else (
  echo No named tunnel config found - starting a throwaway quick tunnel.
  echo The https://....trycloudflare.com URL printed below CHANGES on every restart.
  tools\cloudflared.exe tunnel --url http://localhost:3001
)
pause

# Full pipeline over every episode: transcribe → speaker-match → scene-tag.
# Stops KoboldCpp first (both want the GPU), restarts it at the end.
# Log: C:\.Beni\logs\batch.log      Run anytime; finished steps are skipped/redone cheaply.
$py = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
$log = "C:\.Beni\logs\batch.log"
"[$(Get-Date)] batch start" | Out-File -Append $log -Encoding utf8
taskkill /IM koboldcpp.exe /F 2>$null
& $py (Join-Path $PSScriptRoot "isolate.py") *>> $log
& $py (Join-Path $PSScriptRoot "transcribe.py") *>> $log
& $py (Join-Path $PSScriptRoot "diarize_match.py") *>> $log
& $py (Join-Path $PSScriptRoot "scene_tag.py") *>> $log
& $py (Join-Path $PSScriptRoot "beni_frames.py") *>> $log
Start-Process "C:\.Beni\start-model.bat" -WorkingDirectory "C:\.Beni"
"[$(Get-Date)] batch done — next: npm run ingest" | Out-File -Append $log -Encoding utf8

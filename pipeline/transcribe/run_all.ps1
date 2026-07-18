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
Start-Process -FilePath "C:\.Beni\tools\koboldcpp.exe" -ArgumentList "--model","C:\.Beni\models\TheDrummer_Cydonia-24B-v4.3-IQ4_XS.gguf","--usecublas","normal","--gpulayers","999","--contextsize","16384","--flashattention","--quantkv","1","--port","5001" -WorkingDirectory "C:\.Beni"
"[$(Get-Date)] batch done — next: npm run ingest" | Out-File -Append $log -Encoding utf8

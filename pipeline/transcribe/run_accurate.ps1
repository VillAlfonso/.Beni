# Full accurate pass over every episode. Stops KoboldCpp (shares the GPU),
# restarts it at the end. Log: C:\.Beni\logs\accurate.log
#   1. transcribe.py    Whisper large-v3 + word timestamps (all 52)
#   2. align_speakers.py pyannote turns -> word-level speaker split (all 52)
#   3. make_label_sheet  refresh the 6-speaker labeling pages
# Naming (name_transcripts.py) runs separately, after you label speakers.
$py = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
$log = "C:\.Beni\logs\accurate.log"
"[$(Get-Date)] accurate pass start" | Out-File -Append $log -Encoding utf8
taskkill /IM koboldcpp.exe /F 2>$null
& $py (Join-Path $PSScriptRoot "transcribe.py") *>> $log
& $py (Join-Path $PSScriptRoot "align_speakers.py") *>> $log
& $py (Join-Path $PSScriptRoot "make_label_sheet.py") *>> $log
Start-Process "C:\.Beni\start-model.bat" -WorkingDirectory "C:\.Beni"
"[$(Get-Date)] accurate pass done — label speakers, then name_transcripts.py + npm run ingest" | Out-File -Append $log -Encoding utf8

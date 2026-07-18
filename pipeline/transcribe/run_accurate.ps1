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
Start-Process -FilePath "C:\.Beni\tools\koboldcpp.exe" -ArgumentList "--model","C:\.Beni\models\TheDrummer_Cydonia-24B-v4.3-IQ4_XS.gguf","--usecublas","normal","--gpulayers","999","--contextsize","16384","--flashattention","--quantkv","1","--port","5001" -WorkingDirectory "C:\.Beni"
"[$(Get-Date)] accurate pass done — label speakers, then name_transcripts.py + npm run ingest" | Out-File -Append $log -Encoding utf8

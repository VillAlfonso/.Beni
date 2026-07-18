#!/bin/bash
# Reprocess the user's re-downloaded episodes end to end, then refresh everything.
cd /c/.Beni/pipeline/transcribe || exit 1
PY=./.venv/Scripts/python.exe
EPS="24 25 27 30 33 34 36 38 39 44"

taskkill //IM koboldcpp.exe //F 2>/dev/null
mkdir -p /c/.webdownloader/old

echo "=== swap in fixed files ==="
for N in $EPS; do
  [ -f "/c/.webdownloader/re ep$N.mp4" ] || continue
  [ -f "/c/.webdownloader/ep$N.mp4" ] && mv "/c/.webdownloader/ep$N.mp4" "/c/.webdownloader/old/ep$N.orig.mp4"
  mv "/c/.webdownloader/re ep$N.mp4" "/c/.webdownloader/ep$N.mp4"
  P=$(printf %02d $N)
  rm -f work/ep$P.wav work/ep$P.vocals.wav work/ep$P.segments.json work/ep$P.aligned.json work/ep$P.spk_emb.npz work/ep$P.clusters.npz
  echo "swapped ep$N"
done

echo "=== english ending from youtube ==="
$PY -m pip install yt-dlp --quiet 2>&1 | tail -1
$PY -m yt_dlp -x --audio-format m4a -o work/ending.m4a "https://www.youtube.com/watch?v=eqymekJFfzg" 2>&1 | tail -2
if [ -f work/ending.m4a ]; then
  /c/ffmpeg/ffmpeg -y -v error -i work/ending.m4a -ac 1 -ar 16000 work/ending.wav
  $PY -c "
import json
from transcribe import whisper_segments
from pathlib import Path
segs = whisper_segments(Path('work/ending.wav'))
Path('work/ending.segments.json').write_text(json.dumps({'title':'series ending (EN, youtube)','segments':segs},indent=1),encoding='utf-8')
print(f'ending: {len(segs)} segments')
"
fi

echo "=== transcribe fixed eps ==="
for N in $EPS; do $PY transcribe.py --only $N; done
echo "=== align (pyannote) ==="
for N in $EPS; do $PY align_speakers.py --only $N; done
echo "=== name + annotate + scene + readable ==="
$PY name_transcripts.py
$PY annotate_address.py
$PY scene_tag.py
$PY export_readable.py
echo "=== frames + sheets ==="
$PY beni_frames.py
$PY make_label_sheet.py
powershell.exe -Command "Start-Process -FilePath 'C:\\.Beni\\tools\\koboldcpp.exe' -ArgumentList '--model','C:\\.Beni\\models\\TheDrummer_Cydonia-24B-v4.3-IQ4_XS.gguf','--usecublas','normal','--gpulayers','999','--contextsize','16384','--flashattention','--quantkv','1','--port','5001' -WorkingDirectory 'C:\\.Beni'"
echo REPROCESS-COMPLETE

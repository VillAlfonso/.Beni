"""Convert our dataset to Qwen3-TTS fine-tuning manifest format.

Their format (one JSON per line): {"audio": path, "text": str, "ref_audio": path}
— same ref_audio on every row for maximum speaker consistency.
"""
from __future__ import annotations

import json
from pathlib import Path

ADDON = Path(__file__).resolve().parent
DATASET = ADDON / "dataset"

rows = [json.loads(l) for l in (DATASET / "metadata.jsonl").read_text(encoding="utf-8").splitlines()]
ref = max((r for r in rows if r["clean"] and 4 <= r["duration"] <= 9), key=lambda r: len(r["text"]))
ref_path = str((DATASET / ref["audio"]).resolve())

out = []
for r in rows:
    out.append({"audio": str((DATASET / r["audio"]).resolve()), "text": r["text"], "ref_audio": ref_path})
mined = len(out)

# The hand-marked emotion anchors go in too: cut from timestamps chosen by ear,
# isolated from the music bed, and kept only if they actually sounded like her.
emo_file = ADDON / "voice" / "beni-emotions.json"
if emo_file.exists():
    for tag, e in json.loads(emo_file.read_text(encoding="utf-8")).items():
        wav = ADDON / e["audio"]
        text = (e.get("text") or "").strip()
        if not wav.exists() or len(text) < 8:
            continue  # a wordless laugh teaches a text-to-speech model nothing
        out.append({"audio": str(wav.resolve()), "text": text, "ref_audio": ref_path})

(ADDON / "train_raw.jsonl").write_text("\n".join(json.dumps(x, ensure_ascii=False) for x in out), encoding="utf-8")
print(f"{len(out)} rows -> train_raw.jsonl  ({mined} mined + {len(out) - mined} emotion anchors)")
print(f"ref: {ref['audio']}")

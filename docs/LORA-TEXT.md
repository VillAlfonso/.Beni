# Voice LoRA — "her brain", done honestly

**What a LoRA does here**: bakes Beni's *cadence and reflexes* (teasing-first replies, "typical",
deflection patterns) into the model's weights. **What it does not do**: store facts. Story
knowledge, relationships and timeline live in the persona files + RAG — that division is the
architecture, and the app is already accurate without any LoRA. Treat this as polish.

## Data gates (be ruthless)

| Rows (from `npm run export-lora`) | Verdict |
|---|---|
| < 300 | don't train — you'll overfit into a parrot |
| 300–1000 | trainable with augmentation, expect mild style lift |
| 1000+ (most of 51 eps + augmentation) | proper style LoRA |

The 51-episode series should yield roughly 800–1500 Beni lines once transcribed.

### Synthetic bootstrap (optional, works before transcripts exist)

1. Take her ~30 canon quotes + `character/beni/card.md` + a stage file.
2. Have a strong model write 300–600 short RP exchanges *in her voice* across varied scenes
   (prompt: "write a 3-turn exchange where a stranger asks Beni for directions; she answers in
   character" — vary the scenario each time).
3. **Curate by hand.** Delete anything off-voice. Curation is where the quality comes from.
4. Mix bootstrap ≤ 50/50 with real transcript lines once you have them; real lines win conflicts.

## Training (QLoRA)

Base model choice:
- **Cydonia 24B (the model you run)** — train the LoRA *on the same base you serve*, rank 16–32,
  4-bit QLoRA. Needs ~24GB VRAM → rent one A40/A6000 hour (~$0.40–0.80 on RunPod/Vast). Total cost ≈ $2.
- **A 12B (Mag-Mell/Rocinante base)** — trainable **on your own 5060 Ti 16GB** with Unsloth. Then you
  serve the 12B+LoRA instead of Cydonia.

Unsloth recipe (works on both paths):

```python
from unsloth import FastLanguageModel
import json
from datasets import load_dataset

model, tok = FastLanguageModel.from_pretrained(
    "TheDrummer/Cydonia-24B-v4.1",   # or your 12B base
    load_in_4bit=True, max_seq_length=2048,
)
model = FastLanguageModel.get_peft_model(
    model, r=16, lora_alpha=32, lora_dropout=0.05,
    target_modules=["q_proj","k_proj","v_proj","o_proj","gate_proj","up_proj","down_proj"],
)
ds = load_dataset("json", data_files="data/lora/beni-train.jsonl", split="train")
# apply the model's chat template to ds["messages"], then SFTTrainer:
#   epochs 2-3, lr 1e-4 cosine, batch 8 (grad accum), save LoRA adapters
```

- 2–3 epochs max; watch for the parrot effect (verbatim show lines) — that means overfit, lower epochs/rank.
- Export adapters → merge or convert to GGUF-adapter: KoboldCpp loads GGUF LoRA via `--lora`, or
  merge with `llama.cpp/scripts` then re-quantize.
- Evaluate blind: same 10 prompts against base vs LoRA, ask which is more "her".

## Wiring it in

Serve the merged/adapted model in KoboldCpp as usual — the app needs no changes (same endpoint).
Keep RAG on; the LoRA replaces none of it.

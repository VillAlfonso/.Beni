# Image LoRA — Beni for image generation

You already have the dataset seed: `npm run images` downloaded **87 images** from her wiki gallery
to `data/images/beni/`. Your 16GB GPU can train this locally.

## Dataset prep (the part that decides quality)

1. **Cull**: drop duplicates, statues, group shots where she's tiny, heavy motion blur. Target
   40–80 usable images. Screencap more from episodes later for variety (angles, expressions,
   Venetta armor shots as a separate concept).
2. **Crop/upscale**: 1024×1024-ish crops centered on her; upscale soft frames (2x-AnimeSharp).
3. **Tag**: auto-caption with a WD14 tagger (kohya_ss has it built in), then hand-fix. Use a rare
   trigger token: `beni_tk` plus consistent tags: `pink hair, long hair, twin tails (loose),
   turquoise eyes, dark red headband, green neckerchief, black top, magenta shorts, suspenders`.
   Remove those fixed traits from captions you want *absorbed* into the trigger token (standard
   character-LoRA practice: describe what varies, absorb what defines her).

## Training

- **Base**: an anime SDXL checkpoint — Illustrious-XL or a NoobAI/Pony derivative (2026 anime meta;
  pick what your generation UI uses).
- **Tool**: kohya_ss GUI (Windows-friendly) — SDXL LoRA preset:
  rank 16, alpha 8, lr 1e-4 (UNet) / 5e-5 (TE), batch 2 + grad accum, ~1600–2500 steps,
  min-SNR gamma 5, network dropout 0.1. 16GB VRAM handles this with gradient checkpointing.
- Bake 2–3 checkpoints (e.g. every 500 steps) and pick the one that nails likeness *without*
  copying screencap composition.

## Using it

Any SD UI (ComfyUI/Forge) with `<lora:beni_tk:0.8>` + trigger word. Test prompt:
`beni_tk, smirking, looking back over shoulder, city street, night` — if the headband, scarf and
sleepy eyes survive style changes, it's done. For a consistent "photo of her in scenes" workflow,
pair the LoRA with a pose ControlNet.

Keep it personal-use — it's a commercial character.

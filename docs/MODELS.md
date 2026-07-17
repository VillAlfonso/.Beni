# Models

The app talks to any OpenAI-compatible `/chat/completions` endpoint. Set it in **Settings** inside the app (or `.env` for first-boot defaults).

## Recommended local setup (your RTX 5060 Ti 16GB)

**Cydonia 24B** (TheDrummer) — the roleplay fine-tune you asked about — is a strong pick for 16GB local, and running locally is the only path where your future voice-LoRA can actually be loaded.

1. Download **KoboldCpp** (single .exe): https://github.com/LostRuins/koboldcpp/releases
2. Download a Cydonia GGUF, quant **Q4_K_M** (~14GB) or **IQ4_XS** (~13GB, more context headroom):
   search "Cydonia 24B GGUF" on Hugging Face (TheDrummer's page or bartowski's quants — pick the newest Cydonia version available).
3. Launch KoboldCpp → load the GGUF → GPU layers: max / `-1` (fits fully) → context 8192–12288 → start.
   It serves an OpenAI-compatible API on **http://127.0.0.1:5001/v1**.
4. In the app's Settings: endpoint `http://127.0.0.1:5001/v1`, model name anything (Kobold ignores it), no API key. Done.

Expected speed: ~15–30 tok/s. If it's tight on VRAM, drop to IQ4_XS or reduce context.

**Lighter/faster local option**: Mag-Mell 12B or Rocinante 12B (Q5/Q6 GGUF) — very good RP for their size, huge context headroom, and a 12B is also the size you could QLoRA-train **on your own GPU**.

**LM Studio** works identically (endpoint `http://127.0.0.1:1234/v1`).

## Cloud (optional fallback)

- **OpenRouter**: endpoint `https://openrouter.ai/api/v1` + API key + a model id (they list several
  RP-oriented models incl. TheDrummer's; browse https://openrouter.ai/models). Cheap, no GPU load,
  but your LoRA can't be used there and content policies vary by provider.

## Sampler starting points (Settings)

| Param | Cydonia-class | Notes |
|---|---|---|
| temperature | 0.8–1.0 | lower if she rambles off-canon |
| top-p | 0.95 | |
| max tokens | 350–500 | she's a knife, not a monologue |

## Utility model

Memory extraction runs on the "utility" endpoint (defaults to the main one). Local Cydonia handles it fine; a small fast model (or a cheap cloud model) also works — it only needs to emit JSON.

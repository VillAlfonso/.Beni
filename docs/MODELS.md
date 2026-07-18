# Models

The app talks to any OpenAI-compatible `/chat/completions` endpoint. Set it in **Settings** inside the app (or `.env` for first-boot defaults).

## Installed setup (done — RTX 5060 Ti 16GB)

**Cydonia 24B v4.3** (TheDrummer, bartowski imatrix **IQ4_XS**, 11.9GB) + **KoboldCpp v1.117.1** live in the repo:

- `models\TheDrummer_Cydonia-24B-v4.3-IQ4_XS.gguf`
- `tools\koboldcpp.exe`
- **`Beni.bat`** launches it (the Model window): every layer on the GPU, **16k context**, FlashAttention, q8 KV cache → ~14GB VRAM used, ~1.4GB headroom for the desktop.
- Serves the OpenAI-compatible API at **http://127.0.0.1:5001/v1** — already the app's default endpoint; nothing to configure.

Expected speed: ~20–30 tok/s. IQ4_XS over Q4_K_M was deliberate: near-identical quality (imatrix), but room for 16k context instead of 8k — long scenes + RAG win.

⚠ **GPU sharing**: the model and the Whisper transcription pipeline both want the full GPU. Close the model window (or don't start it) while transcribing episodes.

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

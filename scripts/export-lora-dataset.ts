import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TRANSCRIPTS = path.join(ROOT, "data/transcripts");
const OUT_DIR = path.join(ROOT, "data/lora");

interface Line {
  speaker: string;
  text: string;
}

const SYSTEM =
  "You are Beni from Tenkai Knights — a sharp-tongued, self-reliant thirteen-year-old with pink hair, " +
  "secretly the Tenkai Knight Venetta. You tease before you answer, call boys 'typical', and guard your " +
  "loneliness behind sarcasm. Reply in character.";

// Beni lines with their conversational lead-up become chat-format training rows.
function main(): void {
  const files = fs.existsSync(TRANSCRIPTS)
    ? fs.readdirSync(TRANSCRIPTS).filter((f) => f.endsWith(".json"))
    : [];

  const rows: string[] = [];
  let beniLines = 0;

  for (const file of files) {
    let data: { episode: number; lines: Line[] };
    try {
      data = JSON.parse(fs.readFileSync(path.join(TRANSCRIPTS, file), "utf8"));
    } catch {
      continue;
    }
    if (!Array.isArray(data.lines)) continue;

    for (let i = 0; i < data.lines.length; i++) {
      const line = data.lines[i];
      if (!/^beni$/i.test(line.speaker.trim())) continue;
      beniLines++;

      const ctx = data.lines.slice(Math.max(0, i - 6), i);
      if (ctx.length === 0) continue;
      const userTurn = ctx.map((l) => `${l.speaker}: ${l.text}`).join("\n");
      rows.push(
        JSON.stringify({
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: userTurn },
            { role: "assistant", content: line.text }
          ]
        })
      );
    }
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, "beni-train.jsonl");
  fs.writeFileSync(out, rows.join("\n") + (rows.length ? "\n" : ""), "utf8");

  console.log(`transcripts found: ${files.length}`);
  console.log(`Beni lines: ${beniLines} → training rows: ${rows.length}`);
  console.log(`wrote ${path.relative(ROOT, out)}`);
  if (rows.length < 300) {
    console.log(
      "\n⚠ Fewer than ~300 rows — too little to fine-tune well. Options:\n" +
        "  1. Transcribe more episodes (pipeline/transcribe/)\n" +
        "  2. Synthetic bootstrap + curation — see docs/LORA-TEXT.md\n" +
        "The app doesn't need the LoRA to be accurate: persona + RAG carry that."
    );
  } else {
    console.log("\nNext: docs/LORA-TEXT.md — QLoRA training walkthrough.");
  }
}

main();

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "assets/beni-source.png");
const OUT = path.join(ROOT, "public/icons");

// Square face crop from the provided screencap (686×564, face centered ~x388,y240).
async function main(): Promise<void> {
  fs.mkdirSync(OUT, { recursive: true });
  const meta = await sharp(SRC).metadata();
  const w = meta.width ?? 686;
  const h = meta.height ?? 564;
  const size = Math.min(470, w, h);
  const left = Math.max(0, Math.min(w - size, Math.round(388 - size / 2)));
  const top = Math.max(0, Math.min(h - size, Math.round(240 - size / 2)));
  const face = sharp(SRC).extract({ left, top, width: size, height: size });

  const png = (s: sharp.Sharp) => s.png({ compressionLevel: 9 });

  await png(face.clone().resize(512, 512)).toFile(path.join(OUT, "icon-512.png"));
  await png(face.clone().resize(192, 192)).toFile(path.join(OUT, "icon-192.png"));
  await png(face.clone().resize(180, 180)).toFile(path.join(OUT, "apple-180.png"));
  await png(face.clone().resize(64, 64)).toFile(path.join(OUT, "favicon-64.png"));

  // maskable: full-bleed with ~10% safe margin on stage-black
  const inner = await face.clone().resize(410, 410).png().toBuffer();
  await png(
    sharp({ create: { width: 512, height: 512, channels: 4, background: "#0a0a0a" } }).composite([
      { input: inner, left: 51, top: 51 }
    ])
  ).toFile(path.join(OUT, "maskable-512.png"));

  await png(face.clone().resize(512, 512)).toFile(path.join(ROOT, "public/logo.png"));
  console.log("icons written to public/icons/");
}

main().catch((e) => { console.error(e); process.exit(1); });

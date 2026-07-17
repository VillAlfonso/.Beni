import express from "express";
import fs from "node:fs";
import path from "node:path";
import { getDb, PROJECT_ROOT } from "./db.js";
import { authMiddleware } from "./auth.js";
import { miscRouter } from "./routes/misc.js";
import { chatsRouter } from "./routes/chats.js";
import { chatStreamRouter } from "./routes/chat-stream.js";
import { warmup } from "./rag/embedder.js";

const PORT = Number(process.env.PORT) || 3001;
const db = getDb();

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

app.use("/api", authMiddleware(db));
app.use("/api", miscRouter(db));
app.use("/api", chatsRouter(db));
app.use("/api", chatStreamRouter(db));

// production: serve the built SPA (dev uses the Vite server on :5173 instead)
const dist = path.join(PROJECT_ROOT, "dist");
if (fs.existsSync(path.join(dist, "index.html"))) {
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
} else {
  app.get("/", (_req, res) =>
    res
      .status(200)
      .send("Beni RP server is running. Build the UI with `npm run build`, or use `npm run dev` for development.")
  );
}

app.listen(PORT, () => {
  console.log(`Beni RP server → http://localhost:${PORT}`);
  warmup();
});

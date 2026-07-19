import { Router } from "express";
import type { Db } from "../db.js";
import { login } from "../auth.js";
import { maskedSettings, updateSettings, getSettings } from "../settings.js";
import { loadStages, loadEpisodes } from "../prompt/builder.js";
import { retrieveCanon } from "../rag/retrieve.js";

export function miscRouter(db: Db): Router {
  const r = Router();

  r.get("/health", (_req, res) => res.json({ ok: true }));

  r.post("/login", (req, res) => {
    if (login(db, req, res)) return res.json({ ok: true });
    res.status(401).json({ error: "wrong key" });
  });

  r.get("/me", (_req, res) => {
    // reaching here means authMiddleware passed
    res.json({ ok: true });
  });

  r.get("/settings", (_req, res) => res.json(maskedSettings(db)));

  r.put("/settings", (req, res) => {
    const flat = req.body ?? {};
    // ignore masked placeholder keys sent back unchanged
    for (const k of ["llm.apiKey", "utility.apiKey"]) {
      if (typeof flat[k] === "string" && flat[k].startsWith("••••")) delete flat[k];
    }
    updateSettings(db, flat);
    res.json(maskedSettings(db));
  });

  r.get("/character", (_req, res) => {
    res.json({ name: "Beni", stages: loadStages() });
  });

  r.get("/episodes", (_req, res) => res.json(loadEpisodes()));

  r.post("/search", async (req, res) => {
    const q = String(req.body?.q ?? "").trim();
    const cap = Number(req.body?.cap) || 51;
    if (!q) return res.status(400).json({ error: "empty query" });
    const hits = await retrieveCanon(db, q, { cap, k: Number(req.body?.k) || 8 });
    res.json(hits.map((h) => ({ ...h, score: Number(h.score.toFixed(3)) })));
  });

  // proxy to the standalone voice server (addons/tts) — lets the phone use
  // her voice through the tunnel; 503 when the addon isn't running
  r.post("/tts", async (req, res) => {
    const s = getSettings(db);
    if (!s.ttsUrl) return res.status(503).json({ error: "voice addon not configured" });
    try {
      const up = await fetch(s.ttsUrl.replace(/\/+$/, "") + "/speak", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: String(req.body?.text ?? ""), instruct: req.body?.instruct })
      });
      if (!up.ok) {
        const err = await up.text().catch(() => "");
        return res.status(502).json({ error: err.slice(0, 200) || up.statusText });
      }
      res.setHeader("content-type", "audio/wav");
      const buf = Buffer.from(await up.arrayBuffer());
      res.send(buf);
    } catch {
      res.status(503).json({ error: "voice server unreachable — run Beni-voice.bat" });
    }
  });

  r.get("/status", (_req, res) => {
    const s = getSettings(db);
    const counts = db
      .prepare("SELECT (SELECT COUNT(*) FROM docs) docs, (SELECT COUNT(*) FROM chunks) chunks, (SELECT COUNT(*) FROM chats) chats")
      .get();
    res.json({ model: s.llm.model, baseUrl: s.llm.baseUrl, ...(counts as object) });
  });

  return r;
}

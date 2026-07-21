import { Router } from "express";
import type { Db } from "../db.js";
import { login } from "../auth.js";
import { maskedSettings, updateSettings, getSettings } from "../settings.js";
import { loadStages, loadEpisodes } from "../prompt/builder.js";
import { retrieveCanon } from "../rag/retrieve.js";
import { episodeEntry } from "../timeline/load.js";

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

  // Episode picker rows: timeline-authored data wins over the old synopsis list.
  r.get("/episodes", (_req, res) => {
    const base = loadEpisodes();
    const rows = [];
    for (let no = 1; no <= 52; no++) {
      const tl = episodeEntry(no);
      const b = base.find((e) => e.no === no);
      rows.push({
        no,
        title: tl?.title || b?.title || `Episode ${no}`,
        covered: Boolean(tl),
        days: tl ? [tl.days.start, tl.days.end] : null,
        arc: tl?.arcAtStart ?? null,
        where: tl && !tl.beniAbsent ? tl.start.beni.where : null
      });
    }
    res.json(rows);
  });

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
        body: JSON.stringify({ text: String(req.body?.text ?? ""), mood: req.body?.mood })
      });
      if (!up.ok) {
        const err = await up.text().catch(() => "");
        return res.status(502).json({ error: err.slice(0, 200) || up.statusText });
      }
      res.setHeader("content-type", "audio/wav");
      for (const h of ["x-voice-rest", "x-voice-id", "x-voice-cached"]) {
        const v = up.headers.get(h);
        if (v) res.setHeader(h, v);
      }
      res.setHeader("access-control-expose-headers", "x-voice-rest, x-voice-id, x-voice-cached");
      const buf = Buffer.from(await up.arrayBuffer());
      res.send(buf);
    } catch {
      res.status(503).json({ error: "voice server unreachable — run Beni-voice.bat" });
    }
  });

  // she finished the line without being cut off → keep the wav, named by what
  // she said. Interrupted lines are simply never kept.
  r.post("/tts/keep", async (req, res) => {
    const s = getSettings(db);
    if (!s.ttsUrl) return res.status(503).json({ error: "voice addon not configured" });
    try {
      const up = await fetch(s.ttsUrl.replace(/\/+$/, "") + "/keep", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ voice_id: req.body?.voiceId, text: String(req.body?.text ?? "") })
      });
      res.status(up.ok ? 200 : 502).json(await up.json().catch(() => ({})));
    } catch {
      res.status(503).json({ error: "voice server unreachable" });
    }
  });

  // second half of a streamed line (see x-voice-rest header)
  r.get("/tts/rest/:id", async (req, res) => {
    const s = getSettings(db);
    try {
      const up = await fetch(s.ttsUrl.replace(/\/+$/, "") + `/rest/${req.params.id}`);
      if (!up.ok) return res.status(up.status).end();
      res.setHeader("content-type", "audio/wav");
      res.send(Buffer.from(await up.arrayBuffer()));
    } catch {
      res.status(503).end();
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

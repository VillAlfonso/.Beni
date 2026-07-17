import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import type { Db } from "./db.js";
import { getSetting, setSetting } from "./db.js";

const COOKIE = "beni_auth";

function accessKey(db: Db): string {
  return process.env.ACCESS_KEY || getSetting(db, "accessKey") || "";
}

function secret(db: Db): string {
  let s = getSetting(db, "authSecret");
  if (!s) {
    s = randomBytes(32).toString("hex");
    setSetting(db, "authSecret", s);
  }
  return s;
}

function token(db: Db): string {
  return createHmac("sha256", secret(db)).update("beni-session-v1").digest("hex");
}

function cookieValue(req: Request): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === COOKIE) return rest.join("=");
  }
  return null;
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function isAuthed(db: Db, req: Request): boolean {
  const key = accessKey(db);
  if (!key) return true; // auth disabled (localhost use)
  const cookie = cookieValue(req);
  if (cookie && safeEqual(cookie, token(db))) return true;
  const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? "");
  if (bearer && safeEqual(bearer[1], key)) return true;
  return false;
}

export function login(db: Db, req: Request, res: Response): boolean {
  const key = accessKey(db);
  const given = String((req.body as { key?: string })?.key ?? "");
  if (!key || !given || !safeEqual(given, key)) return false;
  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=${token(db)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 90}`
  );
  return true;
}

export function authMiddleware(db: Db) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.path === "/login" || req.path === "/health") return next();
    if (isAuthed(db, req)) return next();
    res.status(401).json({ error: "unauthorized" });
  };
}

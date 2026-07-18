import type { Db } from "./db.js";
import { getSetting, setSetting } from "./db.js";

export interface AppSettings {
  llm: { baseUrl: string; apiKey: string; model: string };
  utility: { baseUrl: string; apiKey: string; model: string };
  gen: { temperature: number; maxTokens: number; topP: number };
  userName: string;
  userLooks: string;
}

const env = (k: string, dflt = "") => process.env[k] ?? dflt;

export function getSettings(db: Db): AppSettings {
  const g = (key: string, dflt: string) => getSetting(db, key) ?? dflt;
  const llmBase = g("llm.baseUrl", env("LLM_BASE_URL", "http://127.0.0.1:5001/v1"));
  const llmKey = g("llm.apiKey", env("LLM_API_KEY"));
  const llmModel = g("llm.model", env("LLM_MODEL", "local"));
  return {
    llm: { baseUrl: llmBase, apiKey: llmKey, model: llmModel },
    utility: {
      baseUrl: g("utility.baseUrl", env("UTILITY_BASE_URL")) || llmBase,
      apiKey: g("utility.apiKey", env("UTILITY_API_KEY")) || llmKey,
      model: g("utility.model", env("UTILITY_MODEL")) || llmModel
    },
    gen: {
      temperature: Number(g("gen.temperature", "0.85")),
      maxTokens: Number(g("gen.maxTokens", "420")),
      topP: Number(g("gen.topP", "0.95"))
    },
    userName: g("userName", ""),
    userLooks: g("userLooks", "")
  };
}

const WRITABLE = new Set([
  "llm.baseUrl", "llm.apiKey", "llm.model",
  "utility.baseUrl", "utility.apiKey", "utility.model",
  "gen.temperature", "gen.maxTokens", "gen.topP",
  "userName", "userLooks", "accessKey"
]);

export function updateSettings(db: Db, flat: Record<string, string>): void {
  for (const [k, v] of Object.entries(flat)) {
    if (!WRITABLE.has(k)) continue;
    setSetting(db, k, String(v));
  }
}

/** Settings safe to send to the client (API keys masked). */
export function maskedSettings(db: Db): Record<string, unknown> {
  const s = getSettings(db);
  const mask = (key: string) => (key ? `••••${key.slice(-4)}` : "");
  return {
    llm: { ...s.llm, apiKey: mask(s.llm.apiKey) },
    utility: { ...s.utility, apiKey: mask(s.utility.apiKey) },
    gen: s.gen,
    userName: s.userName,
    userLooks: s.userLooks,
    authEnabled: Boolean(process.env.ACCESS_KEY || getSetting(db, "accessKey"))
  };
}

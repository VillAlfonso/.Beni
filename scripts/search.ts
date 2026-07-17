import { getDb } from "../src/server/db.js";
import { retrieveCanon } from "../src/server/rag/retrieve.js";

// Usage: npm run search -- "kiiro four leaf clover" --cap 25 [--k 8]
const args = process.argv.slice(2);
const query = args.filter((a) => !a.startsWith("--") && !/^\d+$/.test(a) || args[args.indexOf(a) - 1]?.startsWith("--") === false).find((a) => !a.startsWith("--"));
const flag = (name: string, dflt: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : dflt;
};

if (!query) {
  console.error('Usage: npm run search -- "your query" [--cap 51] [--k 6]');
  process.exit(1);
}

const cap = flag("cap", 51);
const k = flag("k", 6);
const db = getDb();
const hits = await retrieveCanon(db, query, { cap, k });

console.log(`query="${query}" cap=${cap} → ${hits.length} hits\n`);
for (const h of hits) {
  console.log(`— [${h.score.toFixed(3)}] ${h.docTitle} (${h.kind}${h.episode !== null ? `, ep ${h.episode}` : ""})`);
  console.log(`  ${h.text.slice(0, 220).replace(/\n/g, " ")}…\n`);
}

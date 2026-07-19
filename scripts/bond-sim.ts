/**
 * How long does she actually take? Simulates the hidden ladder against a few
 * kinds of player so the pacing can be tuned by evidence instead of vibes.
 * Run: npx tsx scripts/bond-sim.ts
 */
import { applyDelta, eligibilityFrom, tierOf, FRESH_BOND, type Bond } from "../src/server/prompt/bond.js";

function run(label: string, looks: string, deltaPerExchange: number, exchangesPerDay = 6, maxDays = 400) {
  const e = eligibilityFrom(looks);
  let b: Bond = { ...FRESH_BOND };
  const firstReached = new Map<string, number>();
  for (let day = 1; day <= maxDays; day++) {
    for (let i = 0; i < exchangesPerDay; i++) b = applyDelta(b, deltaPerExchange, `d${day}`, e);
    const t = tierOf(b, e);
    if (!firstReached.has(t)) firstReached.set(t, day);
  }
  const reached = [...firstReached.entries()].map(([t, d]) => `${t}@day${d}`).join("  ");
  console.log(`\n${label}`);
  console.log(`  sees: ${e.why}`);
  console.log(`  ceiling: ${e.ceiling}   rate: ${e.rate.toFixed(2)}`);
  console.log(`  ${reached}`);
  console.log(`  after ${maxDays} days: bond=${b.bond.toFixed(1)} spark=${b.spark.toFixed(1)} days=${b.days} → ${tierOf(b, e)}`);
}

// an unrealistically ideal player: every exchange lands as something real
run("SAINT PEER (+7 every exchange, 6/day)", "average-height, average-looking, her age guy", 7);
// consistently good company — the realistic ceiling for a devoted player
run("GOOD PEER (+3 every exchange)", "average-height, average-looking, her age guy", 3);
// pleasant but unremarkable
run("PLEASANT PEER (+1 every exchange)", "average-height, average-looking, her age guy", 1);
// the subconscious thumb on the scale
run("GOOD-LOOKING PEER (+3)", "tall, good-looking, her age guy", 3);
run("UGLY PEER (+3)", "short, ugly, her age guy", 3);
// gated: no romance possible
run("SAINT GIRL (+7)", "average-looking, her age girl", 7);
run("SAINT ADULT (+7)", "tall, striking, an adult guy", 7);

// one bad day after a long good run
{
  const e = eligibilityFrom("average-looking, her age guy");
  let b: Bond = { ...FRESH_BOND };
  for (let day = 1; day <= 60; day++) for (let i = 0; i < 6; i++) b = applyDelta(b, 3, `d${day}`, e);
  const before = { tier: tierOf(b, e), bond: b.bond, spark: b.spark };
  for (let i = 0; i < 3; i++) b = applyDelta(b, -6, "d61", e); // one genuinely bad day
  console.log(`\nONE BAD DAY after 60 good ones`);
  console.log(`  before: ${before.tier} (bond ${before.bond.toFixed(1)}, spark ${before.spark.toFixed(1)})`);
  console.log(`  after : ${tierOf(b, e)} (bond ${b.bond.toFixed(1)}, spark ${b.spark.toFixed(1)})`);
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { entryFor, arcForEpisode, custodyAsOf, capabilitiesAsOf, seedWorld } from "./state.js";
import { ep, FX_ARTIFACTS, FX_ARC } from "./fixtures.test.js";

const EPS = [ep(14, 1, 1), ep(15, 2, 3), ep(16, 6, 6)]; // gap: days 4–5

test("entryFor finds the episode containing a day", () => {
  const r = entryFor(2, EPS);
  assert.ok("episode" in r);
  if ("episode" in r) assert.equal(r.episode.no, 15);
});

test("entryFor reports gap days as between", () => {
  const r = entryFor(4, EPS);
  assert.ok("between" in r);
  if ("between" in r) {
    assert.equal(r.between[0]?.no, 15);
    assert.equal(r.between[1]?.no, 16);
  }
});

test("entryFor before all episodes has null predecessor", () => {
  const r = entryFor(1, [ep(15, 2, 3)]);
  assert.ok("between" in r);
  if ("between" in r) {
    assert.equal(r.between[0], null);
    assert.equal(r.between[1]?.no, 15);
  }
});

test("arcForEpisode matches by range", () => {
  assert.equal(arcForEpisode(20, [FX_ARC])?.id, "s1-infiltrator");
  assert.equal(arcForEpisode(30, [FX_ARC]), null);
});

test("custody respects spans and overrides win from sinceDay", () => {
  assert.equal(custodyAsOf(5, FX_ARTIFACTS, []).get("guardians-control"), "Vilius");
  assert.equal(custodyAsOf(11, FX_ARTIFACTS, []).get("guardians-control"), "Guardians");
  const o = [{ item: "tenkai-stone", holder: "Kiiro", sinceDay: 3, note: "" }];
  assert.equal(custodyAsOf(5, FX_ARTIFACTS, o).get("tenkai-stone"), "Kiiro");
  assert.equal(custodyAsOf(2, FX_ARTIFACTS, o).get("tenkai-stone"), "Beni");
});

test("capabilities derive from custody", () => {
  const on = capabilitiesAsOf(5, FX_ARTIFACTS, []);
  assert.equal(on.find((c) => c.capability === "deploy-minions-to-earth")?.active, true);
  const off = capabilitiesAsOf(11, FX_ARTIFACTS, []);
  const cap = off.find((c) => c.capability === "deploy-minions-to-earth");
  assert.equal(cap?.active, false);
  assert.match(cap?.why ?? "", /held by Guardians/);
});

test("seedWorld seeds cursor, goals incl. arc prime, watcher pressures", () => {
  const e = ep(15, 2, 3, {
    goals: [{ id: "g1", who: "Beni", text: "x", due: { day: 2 }, window: "day", evidence: "fx" }]
  });
  const w = seedWorld(e, FX_ARC);
  assert.deepEqual(w.cursor, { day: 2, timeOfDay: "morning", episode: 15 });
  assert.equal(w.goals[0].id, "arc-prime-s1-infiltrator");
  assert.equal(w.goals[0].due, null);
  assert.equal(w.goals[1].id, "g1");
  assert.equal(w.goals[1].status, "pending");
  assert.ok(w.pressures.some((p) => p.who === "Eurus"));
  assert.equal(w.divergence.length, 0);
});

test("seedWorld without arc still works", () => {
  const w = seedWorld(ep(3, 5, 5), null);
  assert.equal(w.cursor.episode, 3);
  assert.equal(w.goals.length, 0);
  assert.equal(w.pressures.length, 0);
});

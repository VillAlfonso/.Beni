import { test } from "node:test";
import assert from "node:assert/strict";
import { entryFor, arcForEpisode, custodyAsOf, capabilitiesAsOf, seedWorld, advanceCursor, autoMiss } from "./state.js";
import { ep, FX_ARTIFACTS, FX_ARC } from "./fixtures.test.js";
import type { WorldV2 } from "./types.js";

function world(day: number, episode: number, extra: Partial<WorldV2> = {}): WorldV2 {
  return {
    cursor: { day, timeOfDay: "morning", episode },
    goals: [],
    divergence: [],
    artifactOverrides: [],
    pressures: [],
    events: [],
    beni: "",
    ...extra
  };
}

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

// ---- rollover ----

const ROLL_EPS = [
  ep(14, 1, 1),
  ep(15, 2, 3, { goals: [{ id: "g15", who: "Beni", text: "x", due: { day: 2 }, window: "day", evidence: "fx" }] }),
  ep(16, 6, 6, { goals: [{ id: "g16", who: "Vilius", text: "y", due: { day: 6 }, window: "day", evidence: "fx" }] })
];

test("advanceCursor is a no-op inside the current episode", () => {
  const { world: w, entered } = advanceCursor(world(3, 15), ROLL_EPS);
  assert.equal(w.cursor.episode, 15);
  assert.equal(entered.length, 0);
});

test("advanceCursor stays put in gap days (free days)", () => {
  const { world: w, entered } = advanceCursor(world(4, 15), ROLL_EPS);
  assert.equal(w.cursor.episode, 15); // days 4–5 are the gap before ep 16
  assert.equal(entered.length, 0);
});

test("advanceCursor enters the next episode when its start day is reached", () => {
  const { world: w, entered } = advanceCursor(world(6, 15), ROLL_EPS);
  assert.equal(w.cursor.episode, 16);
  assert.equal(entered.length, 1);
  assert.ok(w.goals.some((g) => g.id === "g16" && g.status === "pending"));
  assert.ok(w.events.some((e) => e.includes('Episode 16')));
});

test("advanceCursor crosses multiple episodes on a big skip", () => {
  const { world: w, entered } = advanceCursor(world(6, 14), ROLL_EPS);
  assert.equal(w.cursor.episode, 16);
  assert.equal(entered.map((e) => e.no).join(","), "15,16");
  assert.ok(w.goals.some((g) => g.id === "g15"));
  assert.ok(w.goals.some((g) => g.id === "g16"));
});

test("advanceCursor never duplicates goals already in the ledger", () => {
  const start = world(6, 15, {
    goals: [{ id: "g16", who: "Vilius", text: "y", status: "done", due: 6, au: false, note: "" }]
  });
  const { world: w } = advanceCursor(start, ROLL_EPS);
  assert.equal(w.goals.filter((g) => g.id === "g16").length, 1);
  assert.equal(w.goals[0].status, "done");
});

// ---- autoMiss ----

test("autoMiss marks overdue pending canon goals and drafts divergence", () => {
  const w = autoMiss(
    world(5, 15, {
      goals: [
        { id: "late", who: "Beni", text: "do the thing", status: "pending", due: 2, au: false, note: "" },
        { id: "arc", who: "Beni", text: "arc goal", status: "pending", due: null, au: false, note: "" },
        { id: "aug", who: "Vilius", text: "au goal", status: "pending", due: 2, au: true, note: "" },
        { id: "fine", who: "Beni", text: "done thing", status: "done", due: 2, au: false, note: "" }
      ]
    })
  );
  assert.equal(w.goals.find((g) => g.id === "late")?.status, "missed");
  assert.equal(w.goals.find((g) => g.id === "arc")?.status, "pending");
  assert.equal(w.goals.find((g) => g.id === "aug")?.status, "pending");
  assert.equal(w.goals.find((g) => g.id === "fine")?.status, "done");
  assert.equal(w.divergence.length, 1);
  assert.match(w.divergence[0].what, /do the thing/);
});

test("autoMiss without overdue goals returns the world unchanged", () => {
  const w0 = world(2, 15, {
    goals: [{ id: "g", who: "Beni", text: "x", status: "pending", due: 2, au: false, note: "" }]
  });
  assert.equal(autoMiss(w0), w0);
});

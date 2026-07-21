import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeV2, parseWorldV2, worldDayKey } from "./world.js";
import { ep } from "./fixtures.test.js";

const EPS = [ep(14, 1, 1), ep(15, 2, 3)];

const V2 = {
  cursor: { day: 4, timeOfDay: "evening", episode: 15 },
  goals: [{ id: "g1", who: "Beni", text: "x", status: "pending", due: 4, au: false, note: "" }],
  divergence: [{ day: 4, what: "w", effect: "e", level: "minor" }],
  artifactOverrides: [{ item: "tenkai-stone", holder: "Kiiro", sinceDay: 4, note: "" }],
  pressures: [{ who: "Gen", level: 1, note: "" }],
  events: ["a"],
  beni: "fine"
};

test("sanitizeV2 keeps a valid v2 world intact", () => {
  const w = sanitizeV2(V2);
  assert.ok(w);
  assert.deepEqual(w, V2);
});

test("sanitizeV2 clamps invalid statuses, levels, and caps arrays", () => {
  const w = sanitizeV2({
    ...V2,
    goals: [{ id: "g1", who: "Beni", text: "x", status: "sparkling", due: "soon", au: 1, note: 5 }],
    divergence: [{ day: "4", what: "w", effect: "e", level: "catastrophic" }],
    events: Array.from({ length: 30 }, (_, i) => `e${i}`),
    pressures: [{ who: "Gen", level: 99, note: "" }]
  });
  assert.ok(w);
  assert.equal(w.goals[0].status, "pending");
  assert.equal(w.goals[0].due, null);
  assert.equal(w.goals[0].au, true);
  assert.equal(w.divergence[0].level, "minor");
  assert.equal(w.events.length, 12);
  assert.equal(w.events[11], "e29"); // keeps the tail
  assert.equal(w.pressures[0].level, 3);
});

test("sanitizeV2 rejects non-worlds", () => {
  assert.equal(sanitizeV2(null), null);
  assert.equal(sanitizeV2("x"), null);
  assert.equal(sanitizeV2({ goals: [] }), null); // no cursor
});

test("parseWorldV2 passes v2 through", () => {
  const w = parseWorldV2(JSON.stringify(V2), 15, EPS);
  assert.ok(w);
  assert.equal(w.cursor.day, 4);
});

test("parseWorldV2 migrates v1: relative day anchored to episode start", () => {
  const v1 = {
    divergence: "minor",
    clock: { day: 2, timeOfDay: "evening" },
    pressures: [{ who: "Gen", level: 2, note: "n" }],
    events: ["happened"],
    beni: "busy"
  };
  const w = parseWorldV2(JSON.stringify(v1), 15, EPS);
  assert.ok(w);
  // ep 15 starts day 2; relative day 2 → canon day 3
  assert.deepEqual(w.cursor, { day: 3, timeOfDay: "evening", episode: 15 });
  assert.equal(w.goals.length, 0);
  assert.equal(w.divergence.length, 1);
  assert.equal(w.divergence[0].level, "minor");
  assert.equal(w.pressures[0].who, "Gen");
  assert.deepEqual(w.events, ["happened"]);
  assert.equal(w.beni, "busy");
});

test("parseWorldV2 migrates v1 with unknown episode to day = relative day", () => {
  const v1 = { divergence: "none", clock: { day: 5, timeOfDay: "morning" }, pressures: [], events: [], beni: "" };
  const w = parseWorldV2(JSON.stringify(v1), 99, EPS);
  assert.ok(w);
  assert.equal(w.cursor.day, 5); // no timeline entry → startDay 1
  assert.equal(w.divergence.length, 0);
});

test("parseWorldV2 handles null and garbage", () => {
  assert.equal(parseWorldV2(null, 15, EPS), null);
  assert.equal(parseWorldV2("not json", 15, EPS), null);
});

test("worldDayKey reads both shapes", () => {
  assert.deepEqual(worldDayKey(JSON.stringify(V2)), { key: "d4", label: "Day 4" });
  assert.deepEqual(worldDayKey(JSON.stringify({ clock: { day: 7 } })), { key: "d7", label: "Day 7" });
  assert.equal(worldDayKey(null), null);
  assert.equal(worldDayKey("{}"), null);
});

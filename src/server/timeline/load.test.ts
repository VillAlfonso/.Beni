import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTimeline } from "./load.js";

test("loadTimeline tolerates partial coverage and returns maps", () => {
  const t = loadTimeline(); // reads real data/timeline/ (may be sparse)
  assert.ok(t.episodes instanceof Map);
  assert.ok(Array.isArray(t.arcs));
  assert.ok(Array.isArray(t.artifacts));
  assert.ok(Array.isArray(t.post));
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeTick } from "./merge.js";
import { FX_ARTIFACTS } from "./fixtures.test.js";
import type { WorldV2 } from "./types.js";

function prev(extra: Partial<WorldV2> = {}): WorldV2 {
  return {
    cursor: { day: 10, timeOfDay: "morning", episode: 15 },
    goals: [
      { id: "a", who: "Beni", text: "goal a", status: "pending", due: 10, au: false, note: "" },
      { id: "b", who: "Vilius", text: "goal b", status: "done", due: 9, au: false, note: "" },
      { id: "c", who: "Beni", text: "goal c", status: "missed", due: 8, au: false, note: "" }
    ],
    divergence: [{ day: 9, what: "old div", effect: "e", level: "minor" }],
    artifactOverrides: [],
    pressures: [{ who: "Gen", level: 1, note: "" }],
    events: ["e1", "e2"],
    beni: "fine",
    ...extra
  };
}

function proposal(mut: (w: WorldV2) => void): WorldV2 {
  const w = prev();
  mut(w);
  return w;
}

test("mergeTick: day cannot rewind and cannot jump more than +3", () => {
  const back = mergeTick(prev(), proposal((w) => (w.cursor.day = 5)), FX_ARTIFACTS);
  assert.equal(back.cursor.day, 10);
  const jump = mergeTick(prev(), proposal((w) => (w.cursor.day = 99)), FX_ARTIFACTS);
  assert.equal(jump.cursor.day, 13);
});

test("mergeTick: episode is always code-owned", () => {
  const w = mergeTick(prev(), proposal((x) => (x.cursor.episode = 40)), FX_ARTIFACTS);
  assert.equal(w.cursor.episode, 15);
});

test("mergeTick: legal status transitions apply, illegal ones are ignored", () => {
  const w = mergeTick(
    prev(),
    proposal((x) => {
      x.goals[0].status = "done";      // pending → done: ok
      x.goals[0].note = "did it";
      x.goals[1].status = "pending";   // done → pending: rejected
      x.goals[2].status = "done";      // missed → done (late): ok
    }),
    FX_ARTIFACTS
  );
  assert.equal(w.goals.find((g) => g.id === "a")?.status, "done");
  assert.equal(w.goals.find((g) => g.id === "a")?.note, "did it");
  assert.equal(w.goals.find((g) => g.id === "b")?.status, "done");
  assert.equal(w.goals.find((g) => g.id === "c")?.status, "done");
});

test("mergeTick: canon goals can never be deleted; unknown ids become AU (max 2)", () => {
  const p = proposal((x) => {
    x.goals = [
      { id: "n1", who: "Gen", text: "new 1", status: "pending", due: null, au: false, note: "" },
      { id: "n2", who: "Gen", text: "new 2", status: "pending", due: null, au: false, note: "" },
      { id: "n3", who: "Gen", text: "new 3", status: "pending", due: null, au: false, note: "" }
    ];
  });
  const w = mergeTick(prev(), p, FX_ARTIFACTS);
  assert.ok(w.goals.some((g) => g.id === "a")); // canon survived
  const aus = w.goals.filter((g) => g.au);
  assert.equal(aus.length, 2); // capped
  assert.ok(aus.every((g) => g.au === true));
});

test("mergeTick: events are append-only", () => {
  const w = mergeTick(prev(), proposal((x) => (x.events = ["e3"])), FX_ARTIFACTS);
  assert.deepEqual(w.events, ["e1", "e2", "e3"]);
});

test("mergeTick: divergence is append-only", () => {
  const w = mergeTick(
    prev(),
    proposal((x) => (x.divergence = [{ day: 10, what: "new div", effect: "e", level: "major" }])),
    FX_ARTIFACTS
  );
  assert.equal(w.divergence.length, 2);
  assert.equal(w.divergence[0].what, "old div");
  assert.equal(w.divergence[1].what, "new div");
});

test("mergeTick: artifact override needs a fresh divergence entry and a known item", () => {
  // no new divergence → rejected
  const noDiv = mergeTick(
    prev(),
    proposal((x) => (x.artifactOverrides = [{ item: "tenkai-stone", holder: "Kiiro", sinceDay: 10, note: "" }])),
    FX_ARTIFACTS
  );
  assert.equal(noDiv.artifactOverrides.length, 0);

  // new divergence + known item → accepted
  const ok = mergeTick(
    prev(),
    proposal((x) => {
      x.divergence.push({ day: 10, what: "she gave it away", effect: "custody shift", level: "major" });
      x.artifactOverrides = [{ item: "tenkai-stone", holder: "Kiiro", sinceDay: 10, note: "gift" }];
    }),
    FX_ARTIFACTS
  );
  assert.equal(ok.artifactOverrides.length, 1);

  // unknown item → rejected even with divergence
  const unknown = mergeTick(
    prev(),
    proposal((x) => {
      x.divergence.push({ day: 10, what: "d", effect: "e", level: "minor" });
      x.artifactOverrides = [{ item: "made-up-thing", holder: "Kiiro", sinceDay: 10, note: "" }];
    }),
    FX_ARTIFACTS
  );
  assert.equal(unknown.artifactOverrides.length, 0);
});

test("mergeTick: garbage proposal returns prev unchanged", () => {
  const p = prev();
  assert.equal(mergeTick(p, null, FX_ARTIFACTS), p);
  assert.equal(mergeTick(p, "words", FX_ARTIFACTS), p);
});

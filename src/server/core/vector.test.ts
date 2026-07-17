import test from "node:test";
import assert from "node:assert/strict";
import { cosineTopK, toBlob, fromBlob, type VecRow } from "./vector.js";

function unit(x: number, y: number): Float32Array {
  const n = Math.hypot(x, y);
  return new Float32Array([x / n, y / n]);
}

test("episode cap filter never leaks future chunks", () => {
  const rows: VecRow[] = [
    { id: "kiiro", vec: unit(1, 0), episode: 46, kind: "character" },
    { id: "warehouse", vec: unit(0.9, 0.1), episode: 15, kind: "location" },
    { id: "timeless", vec: unit(0.8, 0.2), episode: null, kind: "concept" },
    { id: "toy", vec: unit(1, 0.01), episode: null, kind: "merch" }
  ];
  const q = unit(1, 0);

  const capped = cosineTopK(q, rows, 10, { episodeCap: 25, excludeKinds: ["merch"] });
  assert.deepEqual(capped.map((r) => r.id).sort(), ["timeless", "warehouse"]);

  const open = cosineTopK(q, rows, 10, { episodeCap: 51, excludeKinds: ["merch"] });
  assert.equal(open[0].id, "kiiro");
  assert.ok(!open.some((r) => r.id === "toy"));
});

test("blob round trip preserves vectors", () => {
  const v = new Float32Array([0.25, -0.5, 1 / 3]);
  const back = fromBlob(toBlob(v));
  assert.equal(back.length, 3);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(back[i] - v[i]) < 1e-7);
});

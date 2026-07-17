import test from "node:test";
import assert from "node:assert/strict";
import { chunkSections } from "./chunker.js";

test("small sections merge, episode tag is max of merged blocks", () => {
  const chunks = chunkSections(
    [
      { heading: "Personality", text: "She is cunning. ".repeat(10), episode: null },
      { heading: "Arc", text: "She betrays them. ".repeat(10), episode: 34 },
      { heading: "Later", text: "She changes. ".repeat(10), episode: 46 }
    ],
    { target: 2000, overlap: 100 }
  );
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].episode, 46);
});

test("oversized block splits and keeps its episode tag", () => {
  const chunks = chunkSections(
    [{ heading: "Long", text: "A sentence about things. ".repeat(300), episode: 20 }],
    { target: 1000, overlap: 100 }
  );
  assert.ok(chunks.length > 3);
  for (const c of chunks) {
    assert.ok(c.text.length <= 1400);
    assert.equal(c.episode, 20);
  }
});

test("untagged sections stay untagged (timeless)", () => {
  const chunks = chunkSections([{ heading: "", text: "Quarton is a world of blocks. ".repeat(20), episode: null }]);
  assert.equal(chunks[0].episode, null);
});

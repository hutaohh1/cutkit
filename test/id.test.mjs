import test from "node:test";
import assert from "node:assert/strict";
import { isStableId, isUuidV7, newId, uuidv7 } from "../src/id.mjs";

test("uuidv7 has stable version and variant bits", () => {
  const id = uuidv7();
  assert.equal(isUuidV7(id), true);
  assert.equal(id[14], "7");
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab]/);
});

test("newId produces prefixed stable IDs", () => {
  const id = newId("clip");
  assert.equal(isStableId(id, "clip"), true);
  assert.equal(isStableId(id, "track"), false);
});

import test from "node:test";
import assert from "node:assert/strict";
import { applyPatch, parsePointer } from "../src/patch.mjs";

test("JSON Pointer handles escaped tokens", () => {
  assert.deepEqual(parsePointer("/a~1b/~0c"), ["a/b", "~c"]);
});

test("patch is atomic when a later test fails", () => {
  const original = { title: "before", nested: { value: 1 } };
  assert.throws(() => applyPatch(original, [
    { op: "replace", path: "/title", value: "after" },
    { op: "test", path: "/nested/value", value: 2 }
  ]), (error) => error.code === "PATCH_TEST_FAILED");
  assert.equal(original.title, "before");
});

test("array insertion and move work with JSON Patch semantics", () => {
  const result = applyPatch({ items: ["a", "b"] }, [
    { op: "add", path: "/items/1", value: "x" },
    { op: "move", from: "/items/0", path: "/items/-" }
  ]);
  assert.deepEqual(result.document.items, ["x", "b", "a"]);
});

test("move rejects moving a value into its own descendant", () => {
  assert.throws(() => applyPatch({ nested: { child: 1 } }, [
    { op: "move", from: "/nested", path: "/nested/child/new" }
  ]), (error) => error.code === "PATCH_INVALID");
});


import test from "node:test";
import assert from "node:assert/strict";
import { LockManager } from "../src/locks.mjs";

test("locks reject overlapping paths from another actor", () => {
  const document = { clips: [{ clipId: "clip_a", style: { font: "A" } }] };
  const locks = new LockManager();
  locks.acquire({ actor: "alice", target: { path: "/clips/0/style" }, document });
  assert.throws(() => locks.acquire({ actor: "bob", target: { path: "/clips/0/style/font" }, document }), (error) => error.code === "LOCK_VIOLATION");
});

test("same actor can modify its own locked path", () => {
  const document = { clips: [{ clipId: "clip_a", style: { font: "A" } }] };
  const locks = new LockManager();
  locks.acquire({ actor: "alice", target: { objectId: "clip_a", relativePath: "/style" }, document });
  locks.assertPatchAllowed(document, [{ op: "replace", path: "/clips/0/style/font", value: "B" }], "alice");
});

test("expired locks do not block", () => {
  let now = 1000;
  const document = { clips: [{ clipId: "clip_a" }] };
  const locks = new LockManager({ now: () => now });
  locks.acquire({ actor: "alice", target: { path: "/clips/0" }, ttlMs: 10, document });
  now = 1011;
  locks.acquire({ actor: "bob", target: { path: "/clips/0" }, document });
});


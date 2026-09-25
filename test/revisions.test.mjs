import test from "node:test";
import assert from "node:assert/strict";
import { newId } from "../src/id.mjs";
import { RevisionEngine } from "../src/revisions.mjs";

function createTimeline() {
  const trackId = newId("track");
  return {
    schemaVersion: 1,
    timelineId: newId("timeline"),
    revision: 0,
    tracks: [{ trackId, kind: "video", role: "primary" }],
    clips: [{
      clipId: newId("clip"),
      assetId: newId("asset"),
      trackId,
      kind: "video",
      sourceInMs: 0,
      sourceOutMs: 1000,
      timelineStartMs: 0,
      timelineEndMs: 1000,
      speed: 1,
      opacity: 1
    }]
  };
}

test("stale revision is rejected without mutating state", () => {
  const engine = new RevisionEngine(createTimeline());
  const before = engine.snapshot();
  assert.throws(() => engine.commit({
    baseRevision: 4,
    actor: "alice",
    operations: [{ op: "replace", path: "/clips/0/opacity", value: 0.5 }]
  }), (error) => error.code === "REVISION_CONFLICT");
  assert.deepEqual(engine.snapshot(), before);
});

test("patch creates a new revision and event", () => {
  const engine = new RevisionEngine(createTimeline());
  const result = engine.commit({
    baseRevision: 0,
    actor: "alice",
    operations: [{ op: "replace", path: "/clips/0/opacity", value: 0.5 }]
  });
  assert.equal(result.revision, 1);
  assert.equal(engine.document.clips[0].opacity, 0.5);
  assert.equal(engine.events.length, 1);
  assert.equal(engine.history.length, 2);
  assert.notEqual(engine.history[0].hash, engine.history[1].hash);
});

test("immutable timeline metadata cannot be patched", () => {
  const engine = new RevisionEngine(createTimeline());
  assert.throws(() => engine.commit({
    baseRevision: 0,
    actor: "alice",
    operations: [{ op: "replace", path: "/revision", value: 99 }]
  }), (error) => error.code === "PATCH_IMMUTABLE_FIELD");
});

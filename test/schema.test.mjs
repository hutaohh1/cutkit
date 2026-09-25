import test from "node:test";
import assert from "node:assert/strict";
import { newId } from "../src/id.mjs";
import { validateTimeline } from "../src/schema.mjs";

test("timeline schema rejects invalid ranges", () => {
  const trackId = newId("track");
  const timeline = {
    schemaVersion: 1,
    timelineId: newId("timeline"),
    revision: 0,
    tracks: [{ trackId, kind: "video", role: "primary" }],
    clips: [{
      clipId: newId("clip"),
      assetId: newId("asset"),
      trackId,
      kind: "video",
      sourceInMs: 10,
      sourceOutMs: 10,
      timelineStartMs: 0,
      timelineEndMs: 0,
      speed: 1,
      opacity: 1
    }]
  };
  assert.throws(() => validateTimeline(timeline), (error) => error.code === "SCHEMA_VALIDATION_FAILED");
});

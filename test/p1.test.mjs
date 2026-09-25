import test from "node:test";
import assert from "node:assert/strict";
import { newId } from "../src/id.mjs";
import { validateMediaAsset, validateTimelineP1 } from "../src/p1-schema.mjs";

test("P1 timeline accepts optional media, caption, audio, and transition fields", () => {
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
      sourceInMs: 0,
      sourceOutMs: 1000,
      timelineStartMs: 0,
      timelineEndMs: 1000,
      speed: 1,
      opacity: 1,
      sourceUri: "file:///source.mp4",
      sourceHash: "sha256:abc",
      audioPolicy: { role: "dialogue", gainDb: 0 },
      captions: [],
      effects: [],
      transitionIn: { type: "cut" },
      transitionOut: { type: "cut" },
      renderRole: "primary",
      styleRef: "design.json#title"
    }]
  };
  assert.equal(validateTimelineP1(timeline), true);
});

test("audio media can have zero visual dimensions", () => {
  assert.equal(validateMediaAsset({
    schemaVersion: 1,
    assetId: newId("asset"),
    sourceUri: "file:///voice.wav",
    sourceHash: "sha256:abc",
    mediaKind: "audio",
    durationMs: 1000,
    width: 0,
    height: 0,
    fps: 1,
    hasAudio: true,
    colorProfile: "unknown",
    provenance: { kind: "real" }
  }), true);
});

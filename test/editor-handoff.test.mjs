import test from "node:test";
import assert from "node:assert/strict";
import { newId } from "../src/id.mjs";
import { createHandoff, reimportHandoff } from "../src/editor-handoff.mjs";
import { RevisionEngine } from "../src/revisions.mjs";

test("editor handoff exports, hashes, and reimports through revision state", () => {
  const trackId = newId("track");
  const assetId = newId("asset");
  const timeline = {
    schemaVersion: 1,
    timelineId: newId("timeline"),
    revision: 0,
    tracks: [{ trackId, kind: "video", role: "primary" }],
    clips: [{
      clipId: newId("clip"),
      assetId,
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
  const assets = {
    [assetId]: { assetId, sourceUri: "C:/media/source.mp4", sourceHash: "sha256:a" }
  };
  const { manifest, payload } = createHandoff({
    timeline,
    assets,
    format: "edl",
    actor: "editor",
    locks: [],
    options: { fps: 30, title: "Roundtrip" }
  });
  assert.equal(manifest.status, "handed_off");
  const engine = new RevisionEngine(timeline);
  const result = reimportHandoff({
    manifest,
    payload,
    engine,
    actor: "editor",
    assets,
    options: { fps: 30, assetIdByName: { "source.mp4": assetId } }
  });
  assert.equal(result.manifest.status, "reimported");
  assert.equal(result.result.revision, 1);
  assert.equal(result.losses.durationDeltaMs, 0);
});

import test from "node:test";
import assert from "node:assert/strict";
import { newId } from "../src/id.mjs";
import { exportEdl, exportFcpxml, exportOtio, importEdl, importFcpxml, importOtio, roundTripLoss } from "../src/editor-exchange.mjs";

function fixture() {
  const trackId = newId("track");
  const assetA = newId("asset");
  const assetB = newId("asset");
  const assets = {
    [assetA]: { assetId: assetA, sourceUri: "C:/media/a.mp4", sourceHash: "sha256:a", mediaKind: "video", durationMs: 2000, width: 1920, height: 1080, fps: 30, hasAudio: true, colorProfile: "bt709", provenance: { kind: "real" } },
    [assetB]: { assetId: assetB, sourceUri: "C:/media/b.mp4", sourceHash: "sha256:b", mediaKind: "video", durationMs: 2000, width: 1920, height: 1080, fps: 30, hasAudio: true, colorProfile: "bt709", provenance: { kind: "real" } }
  };
  const timeline = {
    schemaVersion: 1,
    timelineId: newId("timeline"),
    revision: 4,
    tracks: [{ trackId, kind: "video", role: "primary" }],
    clips: [
      { clipId: newId("clip"), assetId: assetA, trackId, kind: "video", sourceInMs: 100, sourceOutMs: 1100, timelineStartMs: 0, timelineEndMs: 1000, speed: 1, opacity: 1 },
      { clipId: newId("clip"), assetId: assetB, trackId, kind: "video", sourceInMs: 200, sourceOutMs: 1200, timelineStartMs: 1000, timelineEndMs: 2000, speed: 1, opacity: 1 }
    ]
  };
  return { timeline, assets };
}

test("EDL export and import preserve source and timeline ranges", () => {
  const { timeline, assets } = fixture();
  const edl = exportEdl(timeline, assets, { fps: 30 });
  assert.match(edl, /TITLE: CutKit/);
  assert.match(edl, /^002 /m);
  const imported = importEdl(edl, {
    fps: 30,
    assetIdByName: { "a.mp4": timeline.clips[0].assetId, "b.mp4": timeline.clips[1].assetId },
    timelineId: timeline.timelineId,
    trackId: timeline.tracks[0].trackId
  });
  assert.equal(imported.clips.length, 2);
  assert.equal(imported.clips[0].sourceInMs, 100);
  assert.equal(imported.clips[1].timelineEndMs, 2000);
  assert.equal(roundTripLoss(timeline, imported).durationDeltaMs, 0);
});

test("FCPXML and OTIO round-trip through their interchange models", () => {
  const { timeline, assets } = fixture();
  const assetIdByName = {
    "a.mp4": timeline.clips[0].assetId,
    "b.mp4": timeline.clips[1].assetId
  };
  const fcpxml = exportFcpxml(timeline, assets, { fps: 30 });
  assert.match(fcpxml, /<fcpxml/);
  const importedFcpxml = importFcpxml(fcpxml, {
    assetIdByName,
    timelineId: timeline.timelineId,
    trackId: timeline.tracks[0].trackId
  });
  assert.equal(importedFcpxml.clips.length, 2);
  assert.equal(importedFcpxml.clips[0].timelineStartMs, 0);

  const otio = exportOtio(timeline, assets);
  assert.equal(otio.OTIO_SCHEMA, "Timeline.1");
  const importedOtio = importOtio(otio, {
    assetIdByName: Object.fromEntries(timeline.clips.map((clip) => [clip.assetId, clip.assetId])),
    clipIdByName: Object.fromEntries(timeline.clips.map((clip) => [clip.clipId, clip.clipId])),
    timelineId: timeline.timelineId,
    trackId: timeline.tracks[0].trackId
  });
  assert.equal(importedOtio.clips.length, 2);
  assert.equal(importedOtio.clips[1].timelineEndMs, 2000);
});

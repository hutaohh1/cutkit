import test from "node:test";
import assert from "node:assert/strict";
import { parseFfprobe } from "../src/media.mjs";

test("ffprobe parser normalizes duration, frame rate, and color metadata", () => {
  const asset = parseFfprobe({
    format: { duration: "2.5" },
    streams: [
      { codec_type: "video", width: 1920, height: 1080, avg_frame_rate: "30000/1001", color_space: "bt709", color_transfer: "bt709", color_primaries: "bt709" },
      { codec_type: "audio" }
    ]
  }, { sourceUri: "file:///input.mov", assetId: "asset_01a0cbe4-e970-78a0-8e6e-fef112abe950", sourceHash: "sha256:abc" });
  assert.equal(asset.durationMs, 2500);
  assert.equal(Math.round(asset.fps * 1000) / 1000, 29.97);
  assert.equal(asset.hasAudio, true);
  assert.equal(asset.colorProfile, "bt709/bt709/bt709");
});

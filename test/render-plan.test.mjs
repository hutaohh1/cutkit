import test from "node:test";
import assert from "node:assert/strict";
import { newId } from "../src/id.mjs";
import { buildRenderPlan, createRenderManifest, FINAL_PROFILE, PREVIEW_PROFILE } from "../src/render-plan.mjs";
import { buildFfmpegRenderCommand } from "../src/render-execute.mjs";

function fixture() {
  const trackId = newId("track");
  const assetId = newId("asset");
  const timeline = {
    schemaVersion: 1,
    timelineId: newId("timeline"),
    revision: 3,
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
  const asset = {
    schemaVersion: 1,
    assetId,
    sourceUri: "C:\\source.mp4",
    sourceHash: "sha256:abc",
    mediaKind: "video",
    durationMs: 1000,
    width: 1920,
    height: 1080,
    fps: 30,
    hasAudio: true,
    colorProfile: "bt709",
    provenance: { kind: "real" }
  };
  return { timeline, assets: { [assetId]: asset } };
}

test("render plan is deterministic for the same edit and profile", () => {
  const sourceInput = fixture();
  const firstInput = structuredClone(sourceInput);
  const secondInput = structuredClone(sourceInput);
  const first = buildRenderPlan({ ...firstInput, profile: PREVIEW_PROFILE, environment: { os: "test" } });
  const second = buildRenderPlan({ ...secondInput, profile: PREVIEW_PROFILE, environment: { os: "test" } });
  assert.equal(first.editHash, second.editHash);
  assert.equal(first.renderHash, second.renderHash);
  assert.equal(first.stages.length, 7);
});

test("changing render profile changes render hash and manifest records reproducibility", () => {
  const input = fixture();
  const preview = buildRenderPlan({ ...input, profile: PREVIEW_PROFILE });
  const final = buildRenderPlan({ ...input, profile: FINAL_PROFILE });
  assert.notEqual(preview.renderHash, final.renderHash);
  const manifest = createRenderManifest(final);
  assert.equal(manifest.reproducibility, "visual");
  assert.equal(manifest.plannedRenderHash, final.renderHash);
  assert.notEqual(manifest.renderHash, final.renderHash);
});



test("FFmpeg graph normalizes sample aspect ratio before concat", () => {
  const input = fixture();
  const plan = buildRenderPlan({ ...input, profile: FINAL_PROFILE });
  const command = buildFfmpegRenderCommand(plan, { outputPath: "out.mp4", workDir: "." });
  assert.match(command.args.join(" "), /setsar=1/);
});
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTool } from "../src/process.mjs";
import { resolveTool } from "../src/tool-paths.mjs";
import { probeMedia } from "../src/media.mjs";
import { newId } from "../src/id.mjs";
import { buildRenderPlan, PREVIEW_PROFILE } from "../src/render-plan.mjs";
import { executeRender } from "../src/render-execute.mjs";
import { runAudioQc } from "../src/audio-qc.mjs";

test("renders a real MP4 with bundled FFmpeg and probes the output", async () => {
  const root = await mkdtemp(join(tmpdir(), "cutkit-render-"));
  const source = join(root, "source.mp4");
  const output = join(root, "output.mp4");
  const ffmpeg = await resolveTool("ffmpeg");
  await runTool(ffmpeg, [
    "-hide_banner", "-y",
    "-f", "lavfi", "-i", "testsrc=size=320x240:rate=30:duration=2",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
    "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-shortest",
    source
  ]);

  const asset = await probeMedia(source);
  const timeline = {
    schemaVersion: 1,
    timelineId: newId("timeline"),
    revision: 0,
    tracks: [
      { trackId: newId("track"), kind: "video", role: "primary" },
      { trackId: newId("track"), kind: "audio", role: "primary" }
    ],
    clips: [{
      clipId: newId("clip"),
      assetId: asset.assetId,
      trackId: null,
      kind: "video",
      sourceInMs: 0,
      sourceOutMs: 1000,
      timelineStartMs: 0,
      timelineEndMs: 1000,
      speed: 1,
      opacity: 1
    }]
  };
  timeline.clips[0].trackId = timeline.tracks[0].trackId;
  const plan = buildRenderPlan({
    timeline,
    assets: { [asset.assetId]: asset },
    profile: PREVIEW_PROFILE,
    environment: { test: "integration" }
  });
  const result = await executeRender(plan, { outputPath: output, workDir: root });
  assert.equal(result.status, "RENDERED");
  const rendered = await probeMedia(output);
  assert.equal(rendered.hasAudio, true);
  assert.ok(Math.abs(rendered.durationMs - 1000) < 150, `duration was ${rendered.durationMs}`);
  assert.match(result.outputHash, /^sha256:/);

  const qc = await runAudioQc(output, { policy: { targetLoudnessLufs: -100, truePeakDbtp: 10, maxClippingPercent: 100, maxSilencePercent: 100, maxDialogueMusicOverlapPercent: 100 } });
  assert.equal(typeof qc.metrics.integratedLufs, "number");
  assert.equal(typeof qc.metrics.truePeakDbtp, "number");
});

test("renders captions into a real MP4 with libass", async () => {
  const root = await mkdtemp(join(tmpdir(), "cutkit-caption-render-"));
  const source = join(root, "source.mp4");
  const output = join(root, "captioned.mp4");
  const ffmpeg = await resolveTool("ffmpeg");
  await runTool(ffmpeg, [
    "-hide_banner", "-y",
    "-f", "lavfi", "-i", "testsrc=size=320x240:rate=30:duration=1",
    "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
    "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-shortest",
    source
  ]);
  const asset = await probeMedia(source);
  const trackId = newId("track");
  const timeline = {
    schemaVersion: 1,
    timelineId: newId("timeline"),
    revision: 0,
    tracks: [{ trackId, kind: "video", role: "primary" }],
    clips: [{
      clipId: newId("clip"),
      assetId: asset.assetId,
      trackId,
      kind: "video",
      sourceInMs: 0,
      sourceOutMs: 1000,
      timelineStartMs: 0,
      timelineEndMs: 1000,
      speed: 1,
      opacity: 1,
      captions: [{
        cueId: newId("cue"),
        textId: newId("text"),
        role: "dialogue",
        startMs: 100,
        endMs: 900,
        content: "CutKit caption",
        fontRole: "dialogue",
        lineBreakPolicy: "balance"
      }]
    }]
  };
  const plan = buildRenderPlan({
    timeline,
    assets: { [asset.assetId]: asset },
    profile: PREVIEW_PROFILE,
    environment: { test: "caption-integration" }
  });
  const result = await executeRender(plan, { outputPath: output, workDir: root });
  assert.equal(result.status, "RENDERED");
  const rendered = await probeMedia(output);
  assert.ok(Math.abs(rendered.durationMs - 1000) < 150);
  assert.match(result.command.args.join(" "), /subtitles=filename=captions-/);
});

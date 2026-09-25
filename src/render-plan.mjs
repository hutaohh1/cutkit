import { contentHash, deepClone } from "./canonical-json.mjs";
import { newId } from "./id.mjs";
import { CutKitError } from "./errors.mjs";
import { validateMediaAsset, validateRenderPlan, validateRenderProfile, validateTimelineP1 } from "./p1-schema.mjs";

export const RENDERER_VERSION = "cutkit-render@0.1.1";

export const PREVIEW_PROFILE = {
  profileId: "preview",
  width: 960,
  height: 540,
  fps: 30,
  videoCodec: "libx264",
  audioCodec: "aac",
  pixelFormat: "yuv420p",
  crf: 28,
  reproducibility: "visual"
};

export const FINAL_PROFILE = {
  profileId: "final",
  width: 1920,
  height: 1080,
  fps: 30,
  videoCodec: "libx264",
  audioCodec: "aac",
  pixelFormat: "yuv420p",
  crf: 18,
  reproducibility: "visual"
};

function normalizeProfile(profile = PREVIEW_PROFILE) {
  const normalized = { ...profile };
  validateRenderProfile(normalized);
  return normalized;
}

function assetInput(clip, asset) {
  return {
    assetId: clip.assetId,
    sourceUri: asset?.sourceUri ?? null,
    sourceHash: asset?.sourceHash ?? null,
    sourceInMs: clip.sourceInMs,
    sourceOutMs: clip.sourceOutMs,
    timelineStartMs: clip.timelineStartMs,
    timelineEndMs: clip.timelineEndMs
  };
}

export function buildRenderPlan({ timeline, assets = {}, profile = PREVIEW_PROFILE, environment = {} }) {
  validateTimelineP1(timeline);
  const normalizedProfile = normalizeProfile(profile);
  const assetEntries = Object.entries(assets).sort(([left], [right]) => left.localeCompare(right));
  for (const [, asset] of assetEntries) validateMediaAsset(asset);
  const assetHashes = Object.fromEntries(assetEntries.map(([assetId, asset]) => [assetId, asset.sourceHash]));
  const editHash = contentHash({ timeline, assetHashes });
  const inputs = timeline.clips.map((clip) => assetInput(clip, assets[clip.assetId]));
  const renderHash = contentHash({
    editHash,
    profile: normalizedProfile,
    rendererVersion: RENDERER_VERSION,
    environment
  });
  const plan = {
    schemaVersion: 1,
    planId: newId("plan"),
    timelineId: timeline.timelineId,
    revision: timeline.revision,
    profile: normalizedProfile,
    editHash,
    renderHash,
    inputs,
    stages: [
      { stageId: "probe", kind: "probe", dependsOn: [], params: { assetIds: inputs.map((input) => input.assetId) } },
      { stageId: "normalize", kind: "normalize", dependsOn: ["probe"], params: { pixelFormat: normalizedProfile.pixelFormat } },
      { stageId: "segments", kind: "render_segments", dependsOn: ["normalize"], params: { clipIds: timeline.clips.map((clip) => clip.clipId) } },
      { stageId: "captions", kind: "captions", dependsOn: ["segments"], params: { fontLock: true } },
      { stageId: "compose", kind: "compose", dependsOn: ["captions"], params: { audioPolicy: "from_timeline" } },
      { stageId: "encode", kind: "encode", dependsOn: ["compose"], params: { ...normalizedProfile } },
      { stageId: "qc", kind: "qc", dependsOn: ["encode"], params: { checks: ["duration", "black", "freeze", "loudness", "caption"] } }
    ],
    outputs: [{
      outputId: `${normalizedProfile.profileId}_mp4`,
      path: `renders/${timeline.revision}/${normalizedProfile.profileId}.mp4`,
      container: "mp4",
      videoCodec: normalizedProfile.videoCodec,
      audioCodec: normalizedProfile.audioCodec
    }],
    renderGraph: { timeline: deepClone(timeline), assets: deepClone(assets) },
    environment: deepClone(environment),
    warnings: []
  };
  validateRenderPlan(plan);
  return plan;
}

export function createRenderManifest(plan, options = {}) {
  const environment = { ...(plan.environment ?? {}), ...(options.environment ?? {}) };
  const commandArgs = Array.isArray(options.commandArgs) ? options.commandArgs : [];
  const commandHash = contentHash(commandArgs);
  const renderHash = contentHash({
    plannedRenderHash: plan.renderHash,
    commandHash,
    environment
  });
  return {
    schemaVersion: 1,
    planId: plan.planId,
    timelineId: plan.timelineId,
    revision: plan.revision,
    editHash: plan.editHash,
    plannedRenderHash: plan.renderHash,
    renderHash,
    commandHash,
    rendererVersion: RENDERER_VERSION,
    reproducibility: plan.profile.reproducibility,
    inputHashes: Object.fromEntries(plan.inputs.map((input) => [input.assetId, input.sourceHash])),
    environment,
    outputHashes: {}
  };
}

export function buildFfmpegEncodeArgs(plan, inputPath, outputPath) {
  if (!plan || !inputPath || !outputPath) throw new CutKitError("RENDER_INPUT_REQUIRED", "Render plan, input, and output are required");
  const profile = plan.profile;
  return [
    "-y",
    "-i", inputPath,
    "-c:v", profile.videoCodec,
    "-pix_fmt", profile.pixelFormat,
    "-crf", String(profile.crf ?? 23),
    "-c:a", profile.audioCodec,
    "-movflags", "+faststart",
    outputPath
  ];
}



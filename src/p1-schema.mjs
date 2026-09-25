import { isStableId } from "./id.mjs";
import { validateTimeline } from "./schema.mjs";
import { SchemaValidationError } from "./errors.mjs";

const MEDIA_KINDS = new Set(["video", "audio", "image", "graphic", "caption", "effect"]);
const CAPTION_ROLES = new Set(["dialogue", "voiceover", "label", "annotation"]);
const AUDIO_ROLES = new Set(["dialogue", "voiceover", "ambience", "music", "sfx"]);
const REPRODUCIBILITY = new Set(["semantic", "visual", "pixel", "byte"]);

function errorsFrom(check) {
  const errors = [];
  const add = (path, message) => errors.push({ path, message });
  check(add);
  if (errors.length > 0) throw new SchemaValidationError(errors);
  return true;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isMilliseconds(value) {
  return Number.isInteger(value) && value >= 0;
}

export function validateMediaAsset(asset) {
  return errorsFrom((add) => {
    if (!isObject(asset)) return add("", "media asset must be an object");
    if (asset.schemaVersion !== 1) add("/schemaVersion", "must be 1");
    if (!isStableId(asset.assetId, "asset")) add("/assetId", "must be a stable asset_* UUIDv7");
    if (typeof asset.sourceUri !== "string" || !asset.sourceUri) add("/sourceUri", "must be a non-empty string");
    if (typeof asset.sourceHash !== "string" || !asset.sourceHash.startsWith("sha256:")) add("/sourceHash", "must be a sha256 hash");
    if (!MEDIA_KINDS.has(asset.mediaKind)) add("/mediaKind", "is not supported");
    if (!isMilliseconds(asset.durationMs)) add("/durationMs", "must be a non-negative integer");
    const visual = asset.mediaKind !== "audio";
    if (!Number.isInteger(asset.width) || (visual ? asset.width <= 0 : asset.width < 0)) add("/width", "must be a non-negative integer");
    if (!Number.isInteger(asset.height) || (visual ? asset.height <= 0 : asset.height < 0)) add("/height", "must be a non-negative integer");
    if (!(typeof asset.fps === "number" && asset.fps > 0)) add("/fps", "must be greater than 0");
    if (typeof asset.hasAudio !== "boolean") add("/hasAudio", "must be boolean");
    if (typeof asset.colorProfile !== "string" || !asset.colorProfile) add("/colorProfile", "must be a non-empty string");
    if (!isObject(asset.provenance)) add("/provenance", "must be an object");
  });
}

export function validateCaptionCue(cue) {
  return errorsFrom((add) => {
    if (!isObject(cue)) return add("", "caption cue must be an object");
    if (!isStableId(cue.cueId, "cue")) add("/cueId", "must be a stable cue_* UUIDv7");
    if (!isStableId(cue.textId, "text")) add("/textId", "must be a stable text_* UUIDv7");
    if (!CAPTION_ROLES.has(cue.role)) add("/role", "is not supported");
    if (!isMilliseconds(cue.startMs)) add("/startMs", "must be a non-negative integer");
    if (!isMilliseconds(cue.endMs)) add("/endMs", "must be a non-negative integer");
    if (isMilliseconds(cue.startMs) && isMilliseconds(cue.endMs) && cue.endMs <= cue.startMs) add("/endMs", "must be greater than startMs");
    if (typeof cue.content !== "string" || !cue.content.trim()) add("/content", "must be a non-empty string");
    if (typeof cue.fontRole !== "string" || !cue.fontRole) add("/fontRole", "must be a non-empty string");
    if (!["preserve", "balance", "manual"].includes(cue.lineBreakPolicy)) add("/lineBreakPolicy", "must be preserve, balance, or manual");
    if (cue.safeArea !== undefined) {
      if (!isObject(cue.safeArea)) add("/safeArea", "must be an object");
      else for (const key of ["x", "y", "width", "height"]) {
        if (!(typeof cue.safeArea[key] === "number" && cue.safeArea[key] >= 0 && cue.safeArea[key] <= 1)) add(`/safeArea/${key}`, "must be between 0 and 1");
      }
    }
  });
}

export function validateAudioPolicy(policy) {
  return errorsFrom((add) => {
    if (!isObject(policy)) return add("", "audio policy must be an object");
    if (!AUDIO_ROLES.has(policy.role)) add("/role", "is not supported");
    if (typeof policy.gainDb !== "number") add("/gainDb", "must be a number");
    if (policy.targetLoudnessLufs !== undefined && typeof policy.targetLoudnessLufs !== "number") add("/targetLoudnessLufs", "must be a number");
    if (policy.truePeakDbtp !== undefined && typeof policy.truePeakDbtp !== "number") add("/truePeakDbtp", "must be a number");
    if (policy.ducking !== undefined && !isObject(policy.ducking)) add("/ducking", "must be an object");
  });
}

export function validateRenderProfile(profile) {
  return errorsFrom((add) => {
    if (!isObject(profile)) return add("", "render profile must be an object");
    if (typeof profile.profileId !== "string" || !profile.profileId) add("/profileId", "must be a non-empty string");
    if (!Number.isInteger(profile.width) || profile.width <= 0) add("/width", "must be a positive integer");
    if (!Number.isInteger(profile.height) || profile.height <= 0) add("/height", "must be a positive integer");
    if (!(typeof profile.fps === "number" && profile.fps > 0)) add("/fps", "must be greater than 0");
    if (typeof profile.videoCodec !== "string" || !profile.videoCodec) add("/videoCodec", "must be a non-empty string");
    if (typeof profile.audioCodec !== "string" || !profile.audioCodec) add("/audioCodec", "must be a non-empty string");
    if (typeof profile.pixelFormat !== "string" || !profile.pixelFormat) add("/pixelFormat", "must be a non-empty string");
    if (!REPRODUCIBILITY.has(profile.reproducibility)) add("/reproducibility", "must be semantic, visual, pixel, or byte");
  });
}

export function validateTimelineP1(timeline) {
  validateTimeline(timeline);
  return errorsFrom((add) => {
    for (const [index, clip] of (timeline.clips ?? []).entries()) {
      const path = `/clips/${index}`;
      if (clip.sourceUri !== undefined && (typeof clip.sourceUri !== "string" || !clip.sourceUri)) add(`${path}/sourceUri`, "must be a non-empty string");
      if (clip.sourceHash !== undefined && (typeof clip.sourceHash !== "string" || !clip.sourceHash.startsWith("sha256:"))) add(`${path}/sourceHash`, "must be a sha256 hash");
      if (clip.audioPolicy !== undefined) {
        try { validateAudioPolicy(clip.audioPolicy); } catch (error) { for (const item of error.details.errors) add(`${path}/audioPolicy${item.path}`, item.message); }
      }
      if (clip.captions !== undefined && !Array.isArray(clip.captions)) add(`${path}/captions`, "must be an array");
      else for (const [captionIndex, caption] of (clip.captions ?? []).entries()) {
        try { validateCaptionCue(caption); } catch (error) { for (const item of error.details.errors) add(`${path}/captions/${captionIndex}${item.path}`, item.message); }
      }
      if (clip.effects !== undefined && !Array.isArray(clip.effects)) add(`${path}/effects`, "must be an array");
      if (clip.transitionIn !== undefined && clip.transitionIn !== null && !isObject(clip.transitionIn)) add(`${path}/transitionIn`, "must be an object or null");
      if (clip.transitionOut !== undefined && clip.transitionOut !== null && !isObject(clip.transitionOut)) add(`${path}/transitionOut`, "must be an object or null");
    }
  });
}

export function validateRenderPlan(plan) {
  return errorsFrom((add) => {
    if (!isObject(plan)) return add("", "render plan must be an object");
    if (plan.schemaVersion !== 1) add("/schemaVersion", "must be 1");
    if (!isStableId(plan.planId, "plan")) add("/planId", "must be a stable plan_* UUIDv7");
    if (!isStableId(plan.timelineId, "timeline")) add("/timelineId", "must be a stable timeline_* UUIDv7");
    if (!Number.isInteger(plan.revision) || plan.revision < 0) add("/revision", "must be a non-negative integer");
    if (typeof plan.editHash !== "string" || !plan.editHash.startsWith("sha256:")) add("/editHash", "must be a sha256 hash");
    if (typeof plan.renderHash !== "string" || !plan.renderHash.startsWith("sha256:")) add("/renderHash", "must be a sha256 hash");
    if (!Array.isArray(plan.inputs)) add("/inputs", "must be an array");
    if (!Array.isArray(plan.stages)) add("/stages", "must be an array");
    if (!Array.isArray(plan.outputs)) add("/outputs", "must be an array");
  });
}

export function validateQcReport(report) {
  return errorsFrom((add) => {
    if (!isObject(report)) return add("", "QC report must be an object");
    if (report.schemaVersion !== 1) add("/schemaVersion", "must be 1");
    if (!isStableId(report.reportId, "report")) add("/reportId", "must be a stable report_* UUIDv7");
    if (!["audio", "video", "caption", "render"].includes(report.target)) add("/target", "is not supported");
    if (!Array.isArray(report.checks)) add("/checks", "must be an array");
    if (typeof report.passed !== "boolean") add("/passed", "must be boolean");
    for (const [index, check] of (report.checks ?? []).entries()) {
      if (!["pass", "warn", "fail"].includes(check?.status)) add(`/checks/${index}/status`, "must be pass, warn, or fail");
      if (typeof check?.code !== "string" || !check.code) add(`/checks/${index}/code`, "must be a non-empty string");
    }
  });
}





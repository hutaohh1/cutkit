import { isStableId } from "./id.mjs";
import { parsePointer } from "./patch.mjs";
import { SchemaValidationError } from "./errors.mjs";

const TRACK_KINDS = new Set(["video", "audio", "overlay"]);
const CLIP_KINDS = new Set(["video", "audio", "image", "graphic", "caption", "effect"]);

export function validateTimeline(timeline) {
  const errors = [];
  const add = (path, message) => errors.push({ path, message });
  if (!timeline || typeof timeline !== "object" || Array.isArray(timeline)) throw new SchemaValidationError([{ path: "", message: "timeline must be an object" }]);
  if (timeline.schemaVersion !== 1) add("/schemaVersion", "must be 1");
  if (!isStableId(timeline.timelineId, "timeline")) add("/timelineId", "must be a stable timeline_* UUIDv7");
  if (!Number.isInteger(timeline.revision) || timeline.revision < 0) add("/revision", "must be a non-negative integer");
  if (!Array.isArray(timeline.tracks) || timeline.tracks.length === 0) add("/tracks", "must contain at least one track");
  if (!Array.isArray(timeline.clips)) add("/clips", "must be an array");

  const trackIds = new Set();
  for (const [index, track] of (timeline.tracks ?? []).entries()) {
    const path = `/tracks/${index}`;
    if (!isStableId(track?.trackId, "track")) add(`${path}/trackId`, "must be a stable track_* UUIDv7");
    if (!TRACK_KINDS.has(track?.kind)) add(`${path}/kind`, "must be video, audio, or overlay");
    if (typeof track?.role !== "string" || !track.role) add(`${path}/role`, "must be a non-empty string");
    if (trackIds.has(track?.trackId)) add(`${path}/trackId`, "must be unique");
    trackIds.add(track?.trackId);
  }

  const clipIds = new Set();
  for (const [index, clip] of (timeline.clips ?? []).entries()) {
    const path = `/clips/${index}`;
    if (!isStableId(clip?.clipId, "clip")) add(`${path}/clipId`, "must be a stable clip_* UUIDv7");
    if (!isStableId(clip?.assetId, "asset")) add(`${path}/assetId`, "must be a stable asset_* UUIDv7");
    if (!trackIds.has(clip?.trackId)) add(`${path}/trackId`, "must reference an existing track");
    if (!CLIP_KINDS.has(clip?.kind)) add(`${path}/kind`, "is not a supported clip kind");
    for (const field of ["sourceInMs", "sourceOutMs", "timelineStartMs", "timelineEndMs"]) {
      if (!Number.isInteger(clip?.[field]) || clip[field] < 0) add(`${path}/${field}`, "must be a non-negative integer");
    }
    if (Number.isInteger(clip?.sourceInMs) && Number.isInteger(clip?.sourceOutMs) && clip.sourceOutMs <= clip.sourceInMs) add(`${path}/sourceOutMs`, "must be greater than sourceInMs");
    if (Number.isInteger(clip?.timelineStartMs) && Number.isInteger(clip?.timelineEndMs) && clip.timelineEndMs <= clip.timelineStartMs) add(`${path}/timelineEndMs`, "must be greater than timelineStartMs");
    if (!(typeof clip?.speed === "number" && clip.speed > 0)) add(`${path}/speed`, "must be greater than 0");
    if (!(typeof clip?.opacity === "number" && clip.opacity >= 0 && clip.opacity <= 1)) add(`${path}/opacity`, "must be between 0 and 1");
    if (clipIds.has(clip?.clipId)) add(`${path}/clipId`, "must be unique");
    clipIds.add(clip?.clipId);
  }

  if (errors.length > 0) throw new SchemaValidationError(errors);
  return true;
}

export function validatePatchEnvelope(envelope) {
  const errors = [];
  const add = (path, message) => errors.push({ path, message });
  if (envelope?.schemaVersion !== 1) add("/schemaVersion", "must be 1");
  if (!Number.isInteger(envelope?.baseRevision) || envelope.baseRevision < 0) add("/baseRevision", "must be a non-negative integer");
  if (typeof envelope?.actor !== "string" || envelope.actor.trim() === "") add("/actor", "must be a non-empty string");
  if (!Array.isArray(envelope?.operations)) add("/operations", "must be an array");
  for (const [index, operation] of (envelope?.operations ?? []).entries()) {
    if (!operation || typeof operation !== "object" || typeof operation.op !== "string") {
      add(`/operations/${index}/op`, "must be a supported operation");
      continue;
    }
    if (typeof operation.path !== "string") add(`/operations/${index}/path`, "must be a JSON Pointer");
    else {
      try { parsePointer(operation.path); } catch { add(`/operations/${index}/path`, "must be a valid JSON Pointer"); }
    }
    if ((operation.op === "move" || operation.op === "copy") && typeof operation.from !== "string") add(`/operations/${index}/from`, "must be a JSON Pointer");
  }
  if (envelope?.lockIds !== undefined && !Array.isArray(envelope.lockIds)) add("/lockIds", "must be an array");
  if (errors.length > 0) throw new SchemaValidationError(errors);
  return true;
}

export function validateLock(lock) {
  const errors = [];
  const add = (path, message) => errors.push({ path, message });
  if (typeof lock?.lockId !== "string" || !isStableId(lock.lockId, "lock")) add("/lockId", "must be a stable lock_* UUIDv7");
  if (typeof lock?.actor !== "string" || !lock.actor.trim()) add("/actor", "must be a non-empty string");
  if (typeof lock?.path !== "string") add("/path", "must be a JSON Pointer");
  else {
    try { parsePointer(lock.path); } catch { add("/path", "must be a valid JSON Pointer"); }
  }
  if (!Number.isInteger(lock?.acquiredAt)) add("/acquiredAt", "must be an integer timestamp");
  if (!Number.isInteger(lock?.expiresAt)) add("/expiresAt", "must be an integer timestamp");
  if (errors.length > 0) throw new SchemaValidationError(errors);
  return true;
}

import { isStableId } from "./id.mjs";
import { SchemaValidationError } from "./errors.mjs";

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

export function validateRightsRecord(record) {
  return errorsFrom((add) => {
    if (!isObject(record)) return add("", "rights record must be an object");
    if (!isStableId(record.rightsId, "rights")) add("/rightsId", "must be a stable rights_* UUIDv7");
    if (!isStableId(record.assetId, "asset")) add("/assetId", "must be a stable asset_* UUIDv7");
    if (typeof record.license !== "string" || !record.license) add("/license", "must be a non-empty string");
    if (!["edit", "publish", "internal", "archive"].includes(record.usage)) add("/usage", "must be edit, publish, internal, or archive");
    if (typeof record.territory !== "string" || !record.territory) add("/territory", "must be a non-empty string");
    if (!Array.isArray(record.allowedUses)) add("/allowedUses", "must be an array");
    if (!Array.isArray(record.prohibitedUses)) add("/prohibitedUses", "must be an array");
    if (record.validFrom !== undefined && !Number.isInteger(record.validFrom)) add("/validFrom", "must be an integer timestamp");
    if (record.validUntil !== undefined && !Number.isInteger(record.validUntil)) add("/validUntil", "must be an integer timestamp");
  });
}

export function validateConsentRecord(record) {
  return errorsFrom((add) => {
    if (!isObject(record)) return add("", "consent record must be an object");
    if (!isStableId(record.consentId, "consent")) add("/consentId", "must be a stable consent_* UUIDv7");
    if (!isStableId(record.assetId, "asset")) add("/assetId", "must be a stable asset_* UUIDv7");
    if (!["person", "voice", "brand", "location", "none"].includes(record.subjectType)) add("/subjectType", "is not supported");
    if (typeof record.subjectRef !== "string" || !record.subjectRef) add("/subjectRef", "must be a non-empty string");
    if (!["granted", "denied", "expired", "not_required"].includes(record.status)) add("/status", "is not supported");
    if (!Array.isArray(record.scope)) add("/scope", "must be an array");
    if (record.expiresAt !== undefined && !Number.isInteger(record.expiresAt)) add("/expiresAt", "must be an integer timestamp");
  });
}

export function validateProvenanceManifest(manifest) {
  return errorsFrom((add) => {
    if (!isObject(manifest)) return add("", "provenance manifest must be an object");
    if (manifest.schemaVersion !== 1) add("/schemaVersion", "must be 1");
    if (!isStableId(manifest.manifestId, "manifest")) add("/manifestId", "must be a stable manifest_* UUIDv7");
    if (!isStableId(manifest.assetId, "asset")) add("/assetId", "must be a stable asset_* UUIDv7");
    if (typeof manifest.contentHash !== "string" || !manifest.contentHash.startsWith("sha256:")) add("/contentHash", "must be a sha256 hash");
    if (typeof manifest.integrityHash !== "string" || !manifest.integrityHash.startsWith("sha256:")) add("/integrityHash", "must be a sha256 hash");
    if (typeof manifest.manifestHash !== "string" || !manifest.manifestHash.startsWith("sha256:")) add("/manifestHash", "must be a sha256 hash");
    if (!isObject(manifest.source)) add("/source", "must be an object");
    if (!isObject(manifest.generation)) add("/generation", "must be an object");
    if (!Array.isArray(manifest.rightsIds)) add("/rightsIds", "must be an array");
    if (!Array.isArray(manifest.consentIds)) add("/consentIds", "must be an array");
    if (!["none", "ai_assisted", "ai_generated", "synthetic_procedural"].includes(manifest.disclosure)) add("/disclosure", "is not supported");
    if (!Array.isArray(manifest.edits)) add("/edits", "must be an array");
    if (manifest.previousManifestHash !== null && (typeof manifest.previousManifestHash !== "string" || !manifest.previousManifestHash.startsWith("sha256:"))) add("/previousManifestHash", "must be null or a sha256 hash");
    if (manifest.signature !== undefined && (!isObject(manifest.signature) || typeof manifest.signature.value !== "string")) add("/signature", "must contain a signature value");
  });
}

export function validateHandoffManifest(manifest) {
  return errorsFrom((add) => {
    if (!isObject(manifest)) return add("", "handoff manifest must be an object");
    if (manifest.schemaVersion !== 1) add("/schemaVersion", "must be 1");
    if (!isStableId(manifest.handoffId, "handoff")) add("/handoffId", "must be a stable handoff_* UUIDv7");
    if (!isStableId(manifest.timelineId, "timeline")) add("/timelineId", "must be a stable timeline_* UUIDv7");
    if (!Number.isInteger(manifest.baseRevision) || manifest.baseRevision < 0) add("/baseRevision", "must be a non-negative integer");
    if (!["edl", "fcpxml", "otio-json"].includes(manifest.format)) add("/format", "must be edl, fcpxml, or otio-json");
    if (typeof manifest.payloadHash !== "string" || !manifest.payloadHash.startsWith("sha256:")) add("/payloadHash", "must be a sha256 hash");
    if (typeof manifest.actor !== "string" || !manifest.actor.trim()) add("/actor", "must be a non-empty string");
    if (!Array.isArray(manifest.locks)) add("/locks", "must be an array");
    if (!["external_editor", "cutkit"].includes(manifest.ownership)) add("/ownership", "must be external_editor or cutkit");
    if (!["handed_off", "reimported", "closed"].includes(manifest.status)) add("/status", "must be handed_off, reimported, or closed");
  });
}



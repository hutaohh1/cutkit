import { isStableId } from "./id.mjs";
import { SchemaValidationError } from "./errors.mjs";

const PROJECT_STATES = new Set([
  "DRAFT", "INGESTING", "INDEXED", "PLANNING", "MATERIAL_CHECK", "BUILDING",
  "RENDERING", "REVIEW_REQUIRED", "REVISING", "READY_FOR_APPROVAL", "APPROVED",
  "FINALIZED", "FAILED", "BLOCKED"
]);
const INTENT_TYPES = new Set(["shot_role", "fact", "tag", "clip"]);
const AVOID_TYPES = new Set(["tag", "synthetic_person", "shot_role", "asset"]);
const ASSET_KINDS = new Set(["REAL", "SYNTHETIC_PROCEDURAL", "SYNTHETIC_GENERATED"]);
const FACTUAL_ROLES = new Set(["person", "place", "product", "evidence", "testimony", "event", "identity"]);
const REVIEW_DIMENSIONS = new Set([
  "factuality", "intent_coverage", "structure", "pacing", "av_quality", "continuity", "material_policy"
]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function errorsFrom(check) {
  const errors = [];
  const add = (path, message) => errors.push({ path, message });
  check(add);
  if (errors.length > 0) throw new SchemaValidationError(errors);
  return true;
}

function isPercent(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

function isScore(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isMs(value) {
  return Number.isInteger(value) && value >= 0;
}

function uniqueStrings(values) {
  return Array.isArray(values) && values.every(isNonEmptyString) && new Set(values).size === values.length;
}

export function validateIntent(intent) {
  return errorsFrom((add) => {
    if (!isObject(intent)) return add("", "intent must be an object");
    if (intent.schemaVersion !== 1) add("/schemaVersion", "must be 1");
    if (!Number.isInteger(intent.targetDurationMs) || intent.targetDurationMs <= 0) add("/targetDurationMs", "must be a positive integer");
    if (!Number.isInteger(intent.durationToleranceMs) || intent.durationToleranceMs < 0) add("/durationToleranceMs", "must be a non-negative integer");
    if (!["16:9", "9:16", "1:1", "4:5", "21:9"].includes(intent.aspectRatio)) add("/aspectRatio", "is not supported");
    if (!isObject(intent.style)) add("/style", "must be an object");
    else for (const field of ["tone", "pacing", "visualTreatment"]) if (!isNonEmptyString(intent.style[field])) add(`/style/${field}`, "must be a non-empty string");
    if (!isNonEmptyString(intent.structureTemplate)) add("/structureTemplate", "must be a non-empty string");
    if (!Array.isArray(intent.mustInclude)) add("/mustInclude", "must be an array");
    else {
      const ids = new Set();
      for (const [index, item] of intent.mustInclude.entries()) {
        const path = `/mustInclude/${index}`;
        if (!isObject(item)) { add(path, "must be an object"); continue; }
        if (!isNonEmptyString(item.id)) add(`${path}/id`, "must be a non-empty string");
        if (ids.has(item.id)) add(`${path}/id`, "must be unique");
        ids.add(item.id);
        if (!INTENT_TYPES.has(item.type)) add(`${path}/type`, "is not supported");
        if (!isNonEmptyString(item.value)) add(`${path}/value`, "must be a non-empty string");
        if (typeof item.blocking !== "boolean") add(`${path}/blocking`, "must be boolean");
      }
    }
    if (!Array.isArray(intent.avoid)) add("/avoid", "must be an array");
    else {
      const ids = new Set();
      for (const [index, item] of intent.avoid.entries()) {
        const path = `/avoid/${index}`;
        if (!isObject(item)) { add(path, "must be an object"); continue; }
        if (!isNonEmptyString(item.id)) add(`${path}/id`, "must be a non-empty string");
        if (ids.has(item.id)) add(`${path}/id`, "must be unique");
        ids.add(item.id);
        if (!AVOID_TYPES.has(item.type)) add(`${path}/type`, "is not supported");
        if (!isNonEmptyString(item.value)) add(`${path}/value`, "must be a non-empty string");
      }
    }
    const policy = intent.materialPolicy;
    if (!isObject(policy)) add("/materialPolicy", "must be an object");
    else {
      for (const field of ["minRealScreenTimePercent", "maxProceduralScreenTimePercent", "maxGeneratedScreenTimePercent", "maxSyntheticTotalPercent"]) {
        if (!isPercent(policy[field])) add(`/materialPolicy/${field}`, "must be between 0 and 100");
      }
      if (typeof policy.allowSyntheticAboveLimit !== "boolean") add("/materialPolicy/allowSyntheticAboveLimit", "must be boolean");
    }
    if (!Number.isInteger(intent.seed) || intent.seed < 0) add("/seed", "must be a non-negative integer");
  });
}

export function validateMaterialAsset(asset) {
  return errorsFrom((add) => {
    if (!isObject(asset)) return add("", "material asset must be an object");
    if (!isStableId(asset.assetId, "asset")) add("/assetId", "must be a stable asset_* UUIDv7");
    if (!ASSET_KINDS.has(asset.kind)) add("/kind", "is not supported");
    if (typeof asset.synthetic !== "boolean") add("/synthetic", "must be boolean");
    if (asset.kind === "REAL" && asset.synthetic) add("/synthetic", "REAL assets cannot be synthetic");
    if (asset.kind !== "REAL" && !asset.synthetic) add("/synthetic", "synthetic asset kinds must set synthetic=true");
    if (!isNonEmptyString(asset.uri)) add("/uri", "must be a non-empty string");
    if (!isNonEmptyString(asset.contentHash) || !asset.contentHash.startsWith("sha256:")) add("/contentHash", "must be a sha256 hash");
    if (!uniqueStrings(asset.roles)) add("/roles", "must be an array of unique non-empty strings");
    if (!uniqueStrings(asset.allowedRoles)) add("/allowedRoles", "must be an array of unique non-empty strings");
    if (!uniqueStrings(asset.prohibitedRoles)) add("/prohibitedRoles", "must be an array of unique non-empty strings");
    if (asset.synthetic && (!Array.isArray(asset.allowedRoles) || asset.allowedRoles.length === 0)) add("/allowedRoles", "synthetic assets require at least one allowed role");
    if (asset.synthetic && !Array.isArray(asset.prohibitedRoles)) add("/prohibitedRoles", "synthetic assets must declare prohibited roles");
    if (asset.media !== undefined) {
      if (!isObject(asset.media)) add("/media", "must be an object");
      else {
        if (!isMs(asset.media.durationMs)) add("/media/durationMs", "must be a non-negative integer");
        if (!(typeof asset.media.fps === "number" && asset.media.fps > 0)) add("/media/fps", "must be greater than 0");
        if (!Number.isInteger(asset.media.width) || asset.media.width < 0) add("/media/width", "must be a non-negative integer");
        if (!Number.isInteger(asset.media.height) || asset.media.height < 0) add("/media/height", "must be a non-negative integer");
        if (typeof asset.media.hasAudio !== "boolean") add("/media/hasAudio", "must be boolean");
      }
    }
    const rights = asset.rights;
    if (!isObject(rights)) add("/rights", "must be an object");
    else {
      if (!["cleared", "pending", "restricted", "unknown"].includes(rights.status)) add("/rights/status", "is not supported");
      if (!isNonEmptyString(rights.license)) add("/rights/license", "must be a non-empty string");
      if (!Array.isArray(rights.consentRefs) || !rights.consentRefs.every(isNonEmptyString)) add("/rights/consentRefs", "must be an array of non-empty strings");
    }
    const provenance = asset.provenance;
    if (!isObject(provenance)) add("/provenance", "must be an object");
    else {
      if (!isNonEmptyString(provenance.source)) add("/provenance/source", "must be a non-empty string");
      if (!(isNonEmptyString(provenance.ingestedAt) || Number.isFinite(provenance.ingestedAt))) add("/provenance/ingestedAt", "must be a timestamp");
      if (asset.kind === "SYNTHETIC_PROCEDURAL") {
        for (const field of ["method", "tool"]) if (!isNonEmptyString(provenance[field])) add(`/provenance/${field}`, "is required for procedural assets");
        if (!isNonEmptyString(provenance.recipeHash) || !provenance.recipeHash.startsWith("sha256:")) add("/provenance/recipeHash", "is required and must be sha256");
        if (!isObject(provenance.parameters)) add("/provenance/parameters", "is required for procedural assets");
      }
      if (asset.kind === "SYNTHETIC_GENERATED") {
        for (const field of ["model", "modelVersion", "prompt", "negativePrompt"]) if (!isNonEmptyString(provenance[field])) add(`/provenance/${field}`, "is required for generated assets");
        if (!Array.isArray(provenance.inputRefs)) add("/provenance/inputRefs", "is required for generated assets");
        if (!isObject(provenance.parameters)) add("/provenance/parameters", "is required for generated assets");
      }
    }
  });
}

export function validateCandidateShot(candidate) {
  return errorsFrom((add) => {
    if (!isObject(candidate)) return add("", "candidate shot must be an object");
    if (!/^[a-z][a-z0-9_-]{2,63}$/.test(candidate.candidateId ?? "")) add("/candidateId", "must be a stable lowercase identifier");
    if (!isStableId(candidate.assetId, "asset")) add("/assetId", "must be a stable asset_* UUIDv7");
    for (const field of ["sourceInMs", "sourceOutMs", "recommendedInMs", "recommendedOutMs"]) if (!isMs(candidate[field])) add(`/${field}`, "must be a non-negative integer");
    if (isMs(candidate.sourceInMs) && isMs(candidate.sourceOutMs) && candidate.sourceOutMs <= candidate.sourceInMs) add("/sourceOutMs", "must be greater than sourceInMs");
    if (isMs(candidate.recommendedInMs) && isMs(candidate.recommendedOutMs) && candidate.recommendedOutMs <= candidate.recommendedInMs) add("/recommendedOutMs", "must be greater than recommendedInMs");
    if (isMs(candidate.sourceInMs) && isMs(candidate.recommendedInMs) && candidate.recommendedInMs < candidate.sourceInMs) add("/recommendedInMs", "must be within source range");
    if (isMs(candidate.sourceOutMs) && isMs(candidate.recommendedOutMs) && candidate.recommendedOutMs > candidate.sourceOutMs) add("/recommendedOutMs", "must be within source range");
    if (!uniqueStrings(candidate.roles)) add("/roles", "must be an array of unique non-empty strings");
    if (!uniqueStrings(candidate.tags)) add("/tags", "must be an array of unique non-empty strings");
    const scores = candidate.scores;
    if (!isObject(scores)) add("/scores", "must be an object");
    else for (const field of ["technical", "relevance", "continuity", "safety"]) if (!isScore(scores[field])) add(`/scores/${field}`, "must be between 0 and 1");
    if (!Array.isArray(candidate.qualityFlags) || !candidate.qualityFlags.every(isNonEmptyString)) add("/qualityFlags", "must be an array of non-empty strings");
    if (!isScore(candidate.confidence)) add("/confidence", "must be between 0 and 1");
  });
}

export function validateGap(gap) {
  return errorsFrom((add) => {
    if (!isObject(gap)) return add("", "gap must be an object");
    if (!/^[a-z][a-z0-9_-]{2,63}$/.test(gap.gapId ?? "")) add("/gapId", "must be a stable lowercase identifier");
    if (!["MISSING_REAL", "MISSING_COVERAGE", "POLICY_VIOLATION", "RIGHTS_REQUIRED"].includes(gap.kind)) add("/kind", "is not supported");
    if (!isNonEmptyString(gap.requiredRole)) add("/requiredRole", "must be a non-empty string");
    if (!isNonEmptyString(gap.reason)) add("/reason", "must be a non-empty string");
    if (typeof gap.blocking !== "boolean") add("/blocking", "must be boolean");
    if (!["REAL_REQUIRED", "AUXILIARY_ALLOWED", "BLOCKED", "HUMAN_REVIEW"].includes(gap.policy)) add("/policy", "is not supported");
    if (gap.mustIncludeRef !== undefined && !isNonEmptyString(gap.mustIncludeRef)) add("/mustIncludeRef", "must be a non-empty string");
    if (gap.assetId !== undefined && !isNonEmptyString(gap.assetId)) add("/assetId", "must be a non-empty string");
  });
}

export function validateReview(review) {
  return errorsFrom((add) => {
    if (!isObject(review)) return add("", "review must be an object");
    if (review.schemaVersion !== 1) add("/schemaVersion", "must be 1");
    if (!/^[a-z][a-z0-9_-]{2,63}$/.test(review.reviewId ?? "")) add("/reviewId", "must be a stable lowercase identifier");
    if (!Number.isInteger(review.revision) || review.revision < 0) add("/revision", "must be a non-negative integer");
    if (!Number.isInteger(review.round) || review.round < 1 || review.round > 3) add("/round", "must be between 1 and 3");
    if (!isNonEmptyString(review.actor)) add("/actor", "must be a non-empty string");
    if (!(isNonEmptyString(review.createdAt) || Number.isFinite(review.createdAt))) add("/createdAt", "must be a timestamp");
    if (!Array.isArray(review.dimensions) || review.dimensions.length === 0 || !review.dimensions.every((value) => REVIEW_DIMENSIONS.has(value)) || new Set(review.dimensions).size !== review.dimensions.length) {
      add("/dimensions", "must contain unique supported review dimensions");
    }
    if (!Array.isArray(review.observations)) add("/observations", "must be an array");
    else {
      const ids = new Set();
      for (const [index, observation] of review.observations.entries()) {
        const path = `/observations/${index}`;
        if (!isObject(observation)) { add(path, "must be an object"); continue; }
        if (!isNonEmptyString(observation.observationId)) add(`${path}/observationId`, "must be a non-empty string");
        if (ids.has(observation.observationId)) add(`${path}/observationId`, "must be unique");
        ids.add(observation.observationId);
        if (!REVIEW_DIMENSIONS.has(observation.dimension)) add(`${path}/dimension`, "is not supported");
        if (!["info", "warning", "blocking"].includes(observation.severity)) add(`${path}/severity`, "is not supported");
        if (!isNonEmptyString(observation.issue)) add(`${path}/issue`, "must be a non-empty string");
        if (!isNonEmptyString(observation.suggestedChange)) add(`${path}/suggestedChange`, "must be a non-empty string");
        const hasClip = isNonEmptyString(observation.clipId);
        const hasRange = isMs(observation.startMs) && isMs(observation.endMs) && observation.endMs > observation.startMs;
        if (!hasClip && !hasRange) add(path, "must locate the issue with clipId or a valid time range");
        if (hasRange && observation.endMs <= observation.startMs) add(`${path}/endMs`, "must be greater than startMs");
      }
    }
    if (!isNonEmptyString(review.summary)) add("/summary", "must be a non-empty string");
  });
}

export function validateForgeRequest(request) {
  return errorsFrom((add) => {
    if (!isObject(request)) return add("", "forge request must be an object");
    if (request.schemaVersion !== 1) add("/schemaVersion", "must be 1");
    for (const [field, pattern] of [["requestId", /^[a-z][a-z0-9_-]{2,63}$/], ["gapId", /^[a-z][a-z0-9_-]{2,63}$/]]) {
      if (!pattern.test(request[field] ?? "")) add(`/${field}`, "must be a stable lowercase identifier");
    }
    if (!["FORGE_A_PROCEDURAL", "FORGE_B_GENERATIVE"].includes(request.forge)) add("/forge", "is not supported");
    if (!isNonEmptyString(request.requestedRole)) add("/requestedRole", "must be a non-empty string");
    if (!Number.isInteger(request.durationMs) || request.durationMs <= 0) add("/durationMs", "must be a positive integer");
    if (!isObject(request.parameters)) add("/parameters", "must be an object");
    if (!(request.approvedBy === null || isNonEmptyString(request.approvedBy))) add("/approvedBy", "must be null or a non-empty string");
    if (request.forge === "FORGE_B_GENERATIVE" && !isNonEmptyString(request.approvedBy)) add("/approvedBy", "Forge-B requires explicit approval");
  });
}

export function validateProjectManifest(manifest) {
  return errorsFrom((add) => {
    if (!isObject(manifest)) return add("", "project manifest must be an object");
    if (manifest.schemaVersion !== 1) add("/schemaVersion", "must be 1");
    if (!isStableId(manifest.projectId, "project")) add("/projectId", "must be a stable project_* UUIDv7");
    if (!PROJECT_STATES.has(manifest.state)) add("/state", "is not a supported lifecycle state");
    for (const field of ["timelineFile", "lockFile", "eventLog", "historyDir"]) if (!isNonEmptyString(manifest[field])) add(`/${field}`, "must be a non-empty string");
    if (manifest.timelineRevision !== undefined && (!Number.isInteger(manifest.timelineRevision) || manifest.timelineRevision < 0)) add("/timelineRevision", "must be a non-negative integer");
    if (manifest.resolution !== undefined && (!Array.isArray(manifest.resolution) || manifest.resolution.length !== 2 || !manifest.resolution.every((value) => Number.isInteger(value) && value > 0))) add("/resolution", "must contain width and height");
  });
}

export function assertFactualRolesUnsupported(asset, roles = asset.roles ?? []) {
  const unsupported = roles.filter((role) => FACTUAL_ROLES.has(role));
  if (asset.synthetic && unsupported.length > 0) {
    throw new SchemaValidationError([{ path: "/roles", message: `synthetic assets cannot assume factual roles: ${unsupported.join(", ")}` }]);
  }
  return true;
}

export const FACTUAL_ROLE_NAMES = FACTUAL_ROLES;

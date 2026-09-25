import { appendFile, mkdir, readFile, rename, writeFile, access, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { contentHash, deepClone } from "./canonical-json.mjs";
import { CutKitError } from "./errors.mjs";
import { newId } from "./id.mjs";
import { createProject, loadProject, persistEngine } from "./file-store.mjs";
import { validateTimelineP1, validateQcReport } from "./p1-schema.mjs";
import {
  assertFactualRolesUnsupported,
  validateCandidateShot,
  validateForgeRequest,
  validateGap,
  validateIntent,
  validateMaterialAsset,
  validateProjectManifest,
  validateReview
} from "./workflow-schema.mjs";
import { calculateScreenTime, evaluateForgeGate, evaluateMaterialPolicy } from "./material-policy.mjs";
import { buildRenderPlan, FINAL_PROFILE, PREVIEW_PROFILE } from "./render-plan.mjs";

const DEFAULT_INTENT = {
  schemaVersion: 1,
  targetDurationMs: 30000,
  durationToleranceMs: 2000,
  aspectRatio: "16:9",
  style: { tone: "documentary", pacing: "measured", visualTreatment: "natural" },
  structureTemplate: "hook_body_end",
  mustInclude: [],
  avoid: [],
  materialPolicy: {
    minRealScreenTimePercent: 80,
    maxProceduralScreenTimePercent: 25,
    maxGeneratedScreenTimePercent: 10,
    maxSyntheticTotalPercent: 30,
    allowSyntheticAboveLimit: false
  },
  seed: 731922
};

const STATE_TRANSITIONS = {
  DRAFT: new Set(["INGESTING", "BLOCKED", "FAILED"]),
  INGESTING: new Set(["INDEXED", "BLOCKED", "FAILED"]),
  INDEXED: new Set(["PLANNING", "BLOCKED", "FAILED"]),
  PLANNING: new Set(["MATERIAL_CHECK", "BUILDING", "BLOCKED", "FAILED"]),
  MATERIAL_CHECK: new Set(["BUILDING", "BLOCKED", "FAILED"]),
  BUILDING: new Set(["RENDERING", "REVIEW_REQUIRED", "BLOCKED", "FAILED"]),
  RENDERING: new Set(["REVIEW_REQUIRED", "BLOCKED", "FAILED"]),
  REVIEW_REQUIRED: new Set(["REVISING", "READY_FOR_APPROVAL", "BLOCKED", "FAILED"]),
  REVISING: new Set(["REVIEW_REQUIRED", "READY_FOR_APPROVAL", "BLOCKED", "FAILED"]),
  READY_FOR_APPROVAL: new Set(["APPROVED", "REVISING", "BLOCKED", "FAILED"]),
  APPROVED: new Set(["FINALIZED"]),
  FINALIZED: new Set(),
  FAILED: new Set(["DRAFT", "INGESTING", "INDEXED", "PLANNING", "MATERIAL_CHECK", "BUILDING", "RENDERING", "REVIEW_REQUIRED"]),
  BLOCKED: new Set(["DRAFT", "PLANNING", "MATERIAL_CHECK", "REVISING"])
};

function nowValue(now) {
  return typeof now === "function" ? now() : (now ?? Date.now());
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temp, path);
}

async function appendJsonLine(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(value)}\n`, "utf8");
}

function normalizeAssets(input) {
  const entries = Array.isArray(input) ? input.map((asset) => [asset.assetId, asset]) : Object.entries(input ?? {});
  const result = {};
  for (const [assetId, asset] of entries) {
    if (!asset || asset.assetId !== assetId) throw new CutKitError("ASSET_ID_MISMATCH", "Asset map key must match assetId", { assetId });
    validateMaterialAsset(asset);
    assertFactualRolesUnsupported(asset);
    result[assetId] = deepClone(asset);
  }
  return result;
}

function normalizeCandidates(input) {
  const values = Array.isArray(input) ? input : Object.values(input ?? {});
  const result = [];
  const ids = new Set();
  for (const candidate of values) {
    validateCandidateShot(candidate);
    if (ids.has(candidate.candidateId)) throw new CutKitError("CANDIDATE_ID_CONFLICT", "Candidate IDs must be unique", { candidateId: candidate.candidateId });
    ids.add(candidate.candidateId);
    result.push(deepClone(candidate));
  }
  return result.sort((left, right) => left.candidateId.localeCompare(right.candidateId));
}

function assertMutableProject(meta) {
  if (meta.state === "FINALIZED") throw new CutKitError("PROJECT_FINALIZED", "Finalized projects are read-only; fork or create a new revision", { projectId: meta.projectId });
}
function pathsFor(meta) {
  return {
    intent: meta.intentFile ?? "intent.json",
    assets: meta.assetFile ?? "assets.json",
    candidates: meta.candidateFile ?? "candidates.json",
    gaps: meta.gapDir ?? "gaps",
    reviews: meta.reviewDir ?? "reviews",
    patches: meta.patchDir ?? "patches",
    forge: meta.forgeDir ?? "forge",
    reports: meta.reportDir ?? "reports",
    renders: meta.renderDir ?? "renders",
    final: meta.finalDir ?? "final"
  };
}

async function readOptionalJson(path, fallback) {
  return await exists(path) ? readJson(path) : fallback;
}

async function writeEvent(root, meta, event) {
  const record = {
    eventId: newId("event"),
    projectId: meta.projectId,
    at: nowValue(),
    ...event
  };
  await appendJsonLine(join(root, meta.eventLog), record);
  return record;
}

async function updateManifest(root, mutate) {
  const path = join(root, "project.json");
  const manifest = await readJson(path);
  const updated = { ...manifest, ...mutate(deepClone(manifest)) };
  updated.updatedAt = nowValue();
  validateProjectManifest(updated);
  await writeJsonAtomic(path, updated);
  return updated;
}

async function transitionInternal(root, target, { actor = "system", causeId = null, reason = "" } = {}) {
  const path = join(root, "project.json");
  const manifest = await readJson(path);
  const from = manifest.state;
  if (from === target) return manifest;
  if (!STATE_TRANSITIONS[from]?.has(target)) {
    throw new CutKitError("INVALID_PROJECT_TRANSITION", "Project lifecycle transition is not allowed", { from, target });
  }
  const updated = await updateManifest(root, (value) => ({ ...value, state: target }));
  await writeEvent(root, updated, {
    event: "project.lifecycle.transition",
    fromState: from,
    toState: target,
    actor,
    causeId,
    reason
  });
  return updated;
}

export const PROJECT_STATES = Object.keys(STATE_TRANSITIONS);

export function canTransition(from, to) {
  return Boolean(STATE_TRANSITIONS[from]?.has(to));
}

export async function createWorkflowProject(root, options = {}) {
  const rootPath = resolve(root);
  validateIntent(options.intent ?? DEFAULT_INTENT);
  const created = await createProject(rootPath, options.projectId);
  const paths = pathsFor({
    intentFile: "intent.json",
    assetFile: "assets.json",
    candidateFile: "candidates.json",
    gapDir: "gaps",
    reviewDir: "reviews",
    patchDir: "patches",
    forgeDir: "forge",
    reportDir: "reports",
    renderDir: "renders",
    finalDir: "final"
  });
  for (const directory of [paths.gaps, paths.reviews, paths.patches, paths.forge, paths.reports, paths.renders, paths.final, "sources", "cache"]) {
    await mkdir(join(rootPath, directory), { recursive: true });
  }
  await writeJsonAtomic(join(rootPath, paths.intent), deepClone(options.intent ?? DEFAULT_INTENT));
  await writeJsonAtomic(join(rootPath, paths.assets), {});
  await writeJsonAtomic(join(rootPath, paths.candidates), []);
  await appendJsonLine(join(rootPath, "history", "approvals.jsonl"), {
    schemaVersion: 1,
    initializedAt: nowValue(),
    note: "append-only approval ledger"
  });
  const manifest = await updateManifest(rootPath, (value) => ({
    ...value,
    state: "DRAFT",
    eventLog: "history/events.jsonl",
    timelineRevision: created.timeline.revision,
    fps: options.fps ?? 30,
    resolution: options.resolution ?? [1920, 1080],
    audioSampleRate: options.audioSampleRate ?? 48000,
    intentFile: paths.intent,
    assetFile: paths.assets,
    candidateFile: paths.candidates,
    gapDir: paths.gaps,
    reviewDir: paths.reviews,
    patchDir: paths.patches,
    forgeDir: paths.forge,
    reportDir: paths.reports,
    renderDir: paths.renders,
    finalDir: paths.final,
    currentTimeline: "history/000000.json",
    lastRender: null,
    lastAudit: null,
    createdAt: nowValue(),
    updatedAt: nowValue()
  }));
  await writeEvent(rootPath, manifest, {
    event: "project.created",
    actor: options.actor ?? "human:operator",
    revision: created.timeline.revision
  });
  return loadWorkflowProject(rootPath);
}

export async function loadWorkflowProject(root) {
  const rootPath = resolve(root);
  const base = await loadProject(rootPath);
  validateProjectManifest(base.meta);
  const paths = pathsFor(base.meta);
  const intent = await readOptionalJson(join(rootPath, paths.intent), deepClone(DEFAULT_INTENT));
  const assets = normalizeAssets(await readOptionalJson(join(rootPath, paths.assets), {}));
  const candidates = normalizeCandidates(await readOptionalJson(join(rootPath, paths.candidates), []));
  return { root: rootPath, meta: base.meta, engine: base.engine, intent, assets, candidates, paths };
}

export async function transitionProject(root, target, options = {}) {
  return transitionInternal(resolve(root), target, options);
}

export async function registerProjectAssets(root, input, options = {}) {
  const rootPath = resolve(root);
  const state = await loadWorkflowProject(rootPath);
  assertMutableProject(state.meta);
  const incoming = normalizeAssets(input);
  const merged = { ...state.assets };
  for (const [assetId, asset] of Object.entries(incoming)) {
    const existing = merged[assetId];
    if (existing && existing.contentHash !== asset.contentHash) {
      throw new CutKitError("ASSET_ID_CONFLICT", "An assetId cannot refer to different content", {
        assetId,
        existingHash: existing.contentHash,
        incomingHash: asset.contentHash
      });
    }
    if (!existing) {
      merged[assetId] = asset;
      await writeEvent(rootPath, state.meta, {
        event: "asset.registered",
        actor: options.actor ?? "human:operator",
        assetId,
        contentHash: asset.contentHash,
        kind: asset.kind
      });
    }
  }
  await writeJsonAtomic(join(rootPath, state.paths.assets), merged);
  if (state.meta.state === "DRAFT") await transitionInternal(rootPath, "INGESTING", { actor: options.actor, reason: "assets registered" });
  return loadWorkflowProject(rootPath);
}

export async function registerProjectCandidates(root, input, options = {}) {
  const rootPath = resolve(root);
  const state = await loadWorkflowProject(rootPath);
  assertMutableProject(state.meta);
  const incoming = normalizeCandidates(input);
  const byId = new Map(state.candidates.map((candidate) => [candidate.candidateId, candidate]));
  for (const candidate of incoming) {
    if (!state.assets[candidate.assetId]) {
      throw new CutKitError("CANDIDATE_ASSET_MISSING", "Candidate references an unregistered asset", {
        candidateId: candidate.candidateId,
        assetId: candidate.assetId
      });
    }
    const existing = byId.get(candidate.candidateId);
    if (existing && contentHash(existing) !== contentHash(candidate)) {
      throw new CutKitError("CANDIDATE_ID_CONFLICT", "A candidateId cannot refer to different recommendations", { candidateId: candidate.candidateId });
    }
    byId.set(candidate.candidateId, candidate);
    if (!existing) await writeEvent(rootPath, state.meta, {
      event: "candidate.indexed",
      actor: options.actor ?? "human:operator",
      candidateId: candidate.candidateId,
      assetId: candidate.assetId
    });
  }
  const candidates = [...byId.values()].sort((left, right) => left.candidateId.localeCompare(right.candidateId));
  await writeJsonAtomic(join(rootPath, state.paths.candidates), candidates);
  if (state.meta.state === "INGESTING") await transitionInternal(rootPath, "INDEXED", { actor: options.actor, reason: "candidate index updated" });
  return loadWorkflowProject(rootPath);
}

function avoidReason(candidate, asset, intent) {
  for (const rule of intent.avoid) {
    if (rule.type === "tag" && candidate.tags.includes(rule.value)) return rule;
    if (rule.type === "shot_role" && candidate.roles.includes(rule.value)) return rule;
    if (rule.type === "asset" && (rule.value === "*" || rule.value === candidate.assetId)) return rule;
    if (rule.type === "synthetic_person" && asset.synthetic && (rule.value === "*" || candidate.roles.includes(rule.value))) return rule;
  }
  return null;
}

function candidateRank(candidate) {
  const score = candidate.scores.relevance * 0.4 + candidate.scores.technical * 0.25 + candidate.scores.continuity * 0.2 + candidate.scores.safety * 0.15;
  return { score, tie: candidate.candidateId };
}

function candidateMatchesRequirement(candidate, requirement) {
  if (requirement.type === "shot_role") return candidate.roles.includes(requirement.value);
  if (requirement.type === "tag") return candidate.tags.includes(requirement.value);
  if (requirement.type === "clip") return candidate.candidateId === requirement.value || candidate.assetId === requirement.value;
  if (requirement.type === "fact") return candidate.roles.includes(`fact:${requirement.value}`);
  return false;
}

export async function compileTimelineFromCandidates(root, options = {}) {
  const rootPath = resolve(root);
  const state = await loadWorkflowProject(rootPath);
  assertMutableProject(state.meta);
  const intent = options.intent ? deepClone(options.intent) : state.intent;
  validateIntent(intent);
  if (state.meta.state === "INDEXED") await transitionInternal(rootPath, "PLANNING", { actor: options.actor, reason: "timeline compilation started" });

  const usable = state.candidates.filter((candidate) => {
    const asset = state.assets[candidate.assetId];
    return asset && candidate.scores.safety >= (options.minSafety ?? 0.5) && !avoidReason(candidate, asset, intent);
  });
  const ranked = usable.map((candidate) => ({ candidate, rank: candidateRank(candidate) }))
    .sort((left, right) => right.rank.score - left.rank.score || left.candidate.candidateId.localeCompare(right.candidate.candidateId));

  const selected = [];
  const selectedIds = new Set();
  for (const requirement of intent.mustInclude) {
    const match = ranked.find(({ candidate }) => !selectedIds.has(candidate.candidateId) && candidateMatchesRequirement(candidate, requirement));
    if (match) {
      selected.push({ candidate: match.candidate, refs: [requirement.id] });
      selectedIds.add(match.candidate.candidateId);
    }
  }

  const targetDurationMs = options.targetDurationMs ?? intent.targetDurationMs;
  let plannedMs = selected.reduce((sum, item) => sum + (item.candidate.recommendedOutMs - item.candidate.recommendedInMs), 0);
  for (const { candidate } of ranked) {
    if (plannedMs >= targetDurationMs || selectedIds.has(candidate.candidateId)) continue;
    selected.push({ candidate, refs: [] });
    selectedIds.add(candidate.candidateId);
    plannedMs += candidate.recommendedOutMs - candidate.recommendedInMs;
  }

  const baseTimeline = state.engine.document;
  const videoTrack = baseTimeline.tracks.find((track) => track.kind === "video") ?? baseTimeline.tracks[0];
  let cursor = 0;
  const clips = [];
  for (const item of selected) {
    const candidate = item.candidate;
    const asset = state.assets[candidate.assetId];
    const requestedDuration = candidate.recommendedOutMs - candidate.recommendedInMs;
    const duration = Math.min(requestedDuration, Math.max(0, targetDurationMs - cursor));
    if (duration <= 0) break;
    const sourceStart = candidate.recommendedInMs;
    const sourceEnd = sourceStart + duration;
    clips.push({
      clipId: newId("clip"),
      assetId: candidate.assetId,
      trackId: videoTrack.trackId,
      kind: "video",
      sourceInMs: sourceStart,
      sourceOutMs: sourceEnd,
      timelineStartMs: cursor,
      timelineEndMs: cursor + duration,
      speed: 1,
      opacity: 1,
      sourceUri: asset.uri,
      sourceHash: asset.contentHash,
      renderRole: candidate.roles[0] ?? "broll",
      candidateId: candidate.candidateId,
      mustIncludeRefs: item.refs,
      transitionIn: clips.length === 0 ? null : { type: "cut", durationMs: 0 },
      transitionOut: { type: "cut", durationMs: 0 }
    });
    cursor += duration;
  }
  const timeline = {
    ...deepClone(baseTimeline),
    revision: state.engine.currentRevision,
    durationMs: cursor,
    tracks: deepClone(baseTimeline.tracks),
    clips,
    mix: { gainDbByTrack: Object.fromEntries(baseTimeline.tracks.filter((track) => track.kind === "audio").map((track) => [track.trackId, 0])) }
  };
  timeline.timelineHash = contentHash({
    timelineId: timeline.timelineId,
    durationMs: timeline.durationMs,
    tracks: timeline.tracks,
    clips: timeline.clips,
    mix: timeline.mix
  });
  validateTimelineP1(timeline);
  const outputPath = options.output ? resolve(options.output) : join(rootPath, "timeline-draft.json");
  await writeJsonAtomic(outputPath, timeline);
  const currentState = (await readJson(join(rootPath, "project.json"))).state;
  if (currentState === "PLANNING") await transitionInternal(rootPath, "MATERIAL_CHECK", { actor: options.actor, reason: "timeline draft compiled" });
  return { timeline, outputPath, candidateIds: clips.map((clip) => clip.candidateId) };
}

export async function analyzeProjectGaps(root, options = {}) {
  const rootPath = resolve(root);
  const state = await loadWorkflowProject(rootPath);
  assertMutableProject(state.meta);
  const timeline = options.timeline ?? state.engine.document;
  const gaps = [];
  const coverage = new Map();
  for (const clip of timeline.clips ?? []) {
    for (const ref of clip.mustIncludeRefs ?? []) coverage.set(ref, { clipId: clip.clipId, assetId: clip.assetId });
  }
  for (const requirement of state.intent.mustInclude) {
    if (coverage.has(requirement.id)) continue;
    const factual = requirement.type === "fact" || requirement.type === "shot_role";
    const gap = {
      gapId: `gap_${requirement.id}`.replace(/[^a-z0-9_-]/g, "_").toLowerCase(),
      kind: factual ? "MISSING_REAL" : "MISSING_COVERAGE",
      requiredRole: requirement.value,
      reason: factual
        ? `Timeline requires truthful real material for ${requirement.type} ${requirement.value}`
        : `Timeline does not cover required ${requirement.type} ${requirement.value}`,
      blocking: requirement.blocking,
      policy: factual ? "REAL_REQUIRED" : (requirement.blocking ? "HUMAN_REVIEW" : "AUXILIARY_ALLOWED"),
      mustIncludeRef: requirement.id
    };
    validateGap(gap);
    gaps.push(gap);
  }
  for (const clip of timeline.clips ?? []) {
    const asset = state.assets[clip.assetId];
    if (!asset) {
      const gap = {
        gapId: `gap_missing_asset_${clip.clipId}`.replace(/[^a-z0-9_-]/g, "_").toLowerCase(),
        kind: "MISSING_COVERAGE",
        requiredRole: clip.renderRole ?? "unknown",
        reason: "Timeline clip references an asset that is not registered",
        blocking: true,
        policy: "BLOCKED",
        assetId: clip.assetId
      };
      validateGap(gap);
      gaps.push(gap);
      continue;
    }
    const factualRoles = asset.roles.filter((role) => ["person", "place", "product", "evidence", "testimony", "event", "identity"].includes(role));
    if (asset.synthetic && factualRoles.length > 0) {
      const gap = {
        gapId: `gap_synthetic_fact_${clip.clipId}`.replace(/[^a-z0-9_-]/g, "_").toLowerCase(),
        kind: "POLICY_VIOLATION",
        requiredRole: factualRoles.join(","),
        reason: "Synthetic material cannot carry factual roles",
        blocking: true,
        policy: "BLOCKED",
        assetId: asset.assetId,
        details: { clipId: clip.clipId, factualRoles }
      };
      validateGap(gap);
      gaps.push(gap);
    }
    if (asset.kind === "REAL" && asset.rights.status !== "cleared") {
      const gap = {
        gapId: `gap_rights_${clip.clipId}`.replace(/[^a-z0-9_-]/g, "_").toLowerCase(),
        kind: "RIGHTS_REQUIRED",
        requiredRole: clip.renderRole ?? "unknown",
        reason: `Real asset rights are ${asset.rights.status}`,
        blocking: true,
        policy: "HUMAN_REVIEW",
        assetId: asset.assetId,
        details: { clipId: clip.clipId, status: asset.rights.status }
      };
      validateGap(gap);
      gaps.push(gap);
    }
    const avoided = avoidReason({ ...clip, tags: [], roles: [clip.renderRole].filter(Boolean) }, asset, state.intent);
    if (avoided) {
      const gap = {
        gapId: `gap_avoid_${clip.clipId}`.replace(/[^a-z0-9_-]/g, "_").toLowerCase(),
        kind: "POLICY_VIOLATION",
        requiredRole: clip.renderRole ?? "unknown",
        reason: `Clip violates avoid rule ${avoided.id}`,
        blocking: true,
        policy: "BLOCKED",
        assetId: asset.assetId,
        details: { clipId: clip.clipId, rule: avoided }
      };
      validateGap(gap);
      gaps.push(gap);
    }
  }
  const material = evaluateMaterialPolicy({ timeline, assets: state.assets, intent: state.intent });
  if (!material.ok) {
    for (const check of material.checks.filter((item) => item.status === "fail")) {
      const gap = {
        gapId: `gap_material_${check.code}`.toLowerCase(),
        kind: "POLICY_VIOLATION",
        requiredRole: "material_policy",
        reason: check.message,
        blocking: !material.canOverride,
        policy: material.canOverride ? "HUMAN_REVIEW" : "BLOCKED",
        details: { check }
      };
      validateGap(gap);
      gaps.push(gap);
    }
  }
  const analysis = {
    schemaVersion: 1,
    revision: timeline.revision,
    generatedAt: nowValue(),
    gaps,
    material,
    blockingCount: gaps.filter((gap) => gap.blocking).length
  };
  const suffix = String(timeline.revision).padStart(6, "0");
  await writeJsonAtomic(join(rootPath, state.paths.gaps, `analysis-${suffix}.json`), analysis);
  await writeEvent(rootPath, state.meta, {
    event: "gap.analysis.completed",
    actor: options.actor ?? "system",
    revision: timeline.revision,
    gapCount: gaps.length,
    blockingCount: analysis.blockingCount
  });
  return analysis;
}

export async function commitTimelineDraft(root, options = {}) {
  const rootPath = resolve(root);
  const state = await loadWorkflowProject(rootPath);
  assertMutableProject(state.meta);
  const draftPath = options.draftPath ? resolve(options.draftPath) : join(rootPath, "timeline-draft.json");
  const draft = await readJson(draftPath);
  validateTimelineP1(draft);
  const patch = {
    schemaVersion: 1,
    baseRevision: options.baseRevision ?? state.engine.currentRevision,
    actor: options.actor ?? "human:editor",
    operationId: options.operationId,
    causeId: options.causeId,
    operations: [
      { op: "replace", path: "/tracks", value: draft.tracks },
      { op: "replace", path: "/clips", value: draft.clips },
      { op: "add", path: "/durationMs", value: draft.durationMs },
      { op: "add", path: "/mix", value: draft.mix ?? { gainDbByTrack: {} } },
      { op: "add", path: "/timelineHash", value: draft.timelineHash }
    ]
  };
  const result = state.engine.commit(patch);
  await persistEngine(rootPath, state.meta, state.engine, result);
  await updateManifest(rootPath, (value) => ({
    ...value,
    timelineRevision: result.revision,
    currentTimeline: `history/${String(result.revision).padStart(6, "0")}.json`,
    contentHash: contentHash({ timeline: result.document, assets: state.assets, intent: state.intent })
  }));
  if (state.meta.state === "MATERIAL_CHECK") {
    await transitionInternal(rootPath, "BUILDING", { actor: patch.actor, causeId: options.causeId, reason: "timeline draft committed" });
  }
  return result;
}

export function evaluateProjectAudit({ intent, assets, timeline, gaps = [] }) {
  const checks = [];
  const add = (code, status, message, details = {}) => checks.push({ code, status, message, details });
  try {
    validateTimelineP1(timeline);
    add("TIMELINE_SCHEMA", "pass", "Timeline satisfies the executable schema");
  } catch (error) {
    add("TIMELINE_SCHEMA", "fail", "Timeline schema validation failed", { errors: error.details?.errors ?? [] });
  }
  const unknownAssets = timeline.clips.filter((clip) => !assets[clip.assetId]);
  add("ASSET_REFERENCES", unknownAssets.length === 0 ? "pass" : "fail", unknownAssets.length === 0 ? "All clips reference registered assets" : "Timeline contains unregistered assets", { assetIds: [...new Set(unknownAssets.map((clip) => clip.assetId))] });

  const durationMs = timeline.durationMs ?? Math.max(0, ...(timeline.clips ?? []).map((clip) => clip.timelineEndMs));
  const deltaMs = Math.abs(durationMs - intent.targetDurationMs);
  add("DURATION", deltaMs <= intent.durationToleranceMs ? "pass" : "fail", "Timeline duration is within the declared tolerance", { durationMs, targetDurationMs: intent.targetDurationMs, toleranceMs: intent.durationToleranceMs });

  const refs = new Set((timeline.clips ?? []).flatMap((clip) => clip.mustIncludeRefs ?? []));
  const missingRequired = intent.mustInclude.filter((item) => item.blocking && !refs.has(item.id));
  add("MUST_INCLUDE_COVERAGE", missingRequired.length === 0 ? "pass" : "fail", missingRequired.length === 0 ? "All blocking must_include items have timeline evidence" : "Blocking must_include items are not proven by the timeline", { missing: missingRequired.map((item) => item.id) });

  const syntheticFactual = [];
  for (const clip of timeline.clips ?? []) {
    const asset = assets[clip.assetId];
    if (asset?.synthetic && asset.roles.some((role) => ["person", "place", "product", "evidence", "testimony", "event", "identity"].includes(role))) {
      syntheticFactual.push({ clipId: clip.clipId, assetId: asset.assetId, roles: asset.roles });
    }
  }
  add("SYNTHETIC_FACTUAL_ROLES", syntheticFactual.length === 0 ? "pass" : "fail", syntheticFactual.length === 0 ? "Synthetic assets do not claim factual roles" : "Synthetic assets claim factual roles", { violations: syntheticFactual });

  const uncleared = (timeline.clips ?? []).map((clip) => assets[clip.assetId]).filter((asset) => asset?.kind === "REAL" && asset.rights.status !== "cleared");
  add("RIGHTS_CLEARED", uncleared.length === 0 ? "pass" : "fail", uncleared.length === 0 ? "All used real assets are cleared" : "Timeline uses real assets without cleared rights", { assetIds: uncleared.map((asset) => asset.assetId) });

  const material = evaluateMaterialPolicy({ timeline, assets, intent });
  add("MATERIAL_POLICY", material.ok ? "pass" : (material.canOverride ? "warn" : "fail"), material.ok ? "Material policy is satisfied" : "Material policy requires attention", material);

  const blockingGaps = gaps.filter((gap) => gap.blocking);
  add("OPEN_GAPS", blockingGaps.length === 0 ? "pass" : "fail", blockingGaps.length === 0 ? "No blocking gaps remain" : "Blocking gaps remain", { gapIds: blockingGaps.map((gap) => gap.gapId) });

  return {
    schemaVersion: 1,
    reportId: newId("report"),
    target: "render",
    revision: timeline.revision,
    checks,
    passed: checks.every((check) => check.status !== "fail"),
    generatedAt: nowValue()
  };
}

export async function auditProject(root, options = {}) {
  const rootPath = resolve(root);
  const state = await loadWorkflowProject(rootPath);
  assertMutableProject(state.meta);
  const analysis = await analyzeProjectGaps(rootPath, { actor: options.actor });
  const report = evaluateProjectAudit({
    intent: state.intent,
    assets: state.assets,
    timeline: state.engine.document,
    gaps: analysis.gaps
  });
  validateQcReport(report);
  const suffix = String(report.revision).padStart(6, "0");
  const reportPath = join(rootPath, state.paths.reports, `audit-${suffix}.json`);
  await writeJsonAtomic(reportPath, report);
  await updateManifest(rootPath, (value) => ({
    ...value,
    lastAudit: `${state.paths.reports}/audit-${suffix}.json`,
    contentHash: contentHash({ intent: state.intent, assets: state.assets, timeline: state.engine.document })
  }));
  await writeEvent(rootPath, state.meta, {
    event: "project.audit.completed",
    actor: options.actor ?? "system",
    revision: report.revision,
    reportId: report.reportId,
    passed: report.passed
  });
  return { report, reportPath, gaps: analysis };
}

export async function submitProjectReview(root, review, options = {}) {
  const rootPath = resolve(root);
  const state = await loadWorkflowProject(rootPath);
  assertMutableProject(state.meta);
  const reviewDir = join(rootPath, state.paths.reviews);
  await mkdir(reviewDir, { recursive: true });
  const names = (await readdir(reviewDir).catch(() => [])).filter((name) => name.endsWith(".json"));
  const normalized = {
    schemaVersion: 1,
    revision: state.engine.currentRevision,
    round: names.length + 1,
    createdAt: nowValue(),
    ...deepClone(review)
  };
  validateReview(normalized);
  if (normalized.revision !== state.engine.currentRevision) {
    throw new CutKitError("REVIEW_REVISION_CONFLICT", "Review must target the current timeline revision", {
      expectedRevision: state.engine.currentRevision,
      reviewRevision: normalized.revision
    });
  }
  const fileName = `${String(normalized.round).padStart(6, "0")}-${normalized.reviewId}.json`;
  const reviewPath = join(reviewDir, fileName);
  if (await exists(reviewPath)) throw new CutKitError("REVIEW_EXISTS", "Review already exists", { reviewPath });
  await writeJsonAtomic(reviewPath, normalized);
  await writeEvent(rootPath, state.meta, {
    event: "review.submitted",
    actor: normalized.actor,
    causeId: normalized.reviewId,
    revision: normalized.revision,
    round: normalized.round,
    observationCount: normalized.observations.length
  });
  if (state.meta.state !== "REVIEW_REQUIRED") await transitionInternal(rootPath, "REVIEW_REQUIRED", { actor: normalized.actor, causeId: normalized.reviewId, reason: "structured review submitted" });
  return { review: normalized, reviewPath };
}

async function loadReviews(rootPath, paths) {
  const directory = join(rootPath, paths.reviews);
  const names = (await readdir(directory).catch(() => [])).filter((name) => name.endsWith(".json")).sort();
  const reviews = [];
  for (const name of names) reviews.push(await readJson(join(directory, name)));
  return reviews;
}

export async function reviewLoopStatus(root, options = {}) {
  const rootPath = resolve(root);
  const state = await loadWorkflowProject(rootPath);
  const reviews = await loadReviews(rootPath, state.paths);
  const resolutionsPath = join(rootPath, state.paths.reports, "review-resolutions.jsonl");
  const resolutionText = await readFile(resolutionsPath, "utf8").catch(() => "");
  const resolved = new Set(resolutionText.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)).flatMap((entry) => entry.observationIds ?? []));
  const observations = reviews.flatMap((review) => review.observations.map((observation) => ({ ...observation, reviewId: review.reviewId, round: review.round })));
  const open = observations.filter((observation) => !resolved.has(observation.observationId));
  const openBlocking = open.filter((observation) => observation.severity === "blocking");
  const latestRound = reviews.reduce((max, review) => Math.max(max, review.round), 0);
  const lastAuditPath = state.meta.lastAudit ? join(rootPath, state.meta.lastAudit) : null;
  const audit = lastAuditPath && await exists(lastAuditPath) ? await readJson(lastAuditPath) : null;
  let decision = "CONTINUE";
  if (latestRound >= 3) decision = openBlocking.length === 0 && audit?.passed !== false ? "READY_FOR_APPROVAL" : "BLOCKED";
  else if (openBlocking.length === 0 && audit?.passed && reviews.length > 0) decision = "READY_FOR_APPROVAL";
  const result = {
    schemaVersion: 1,
    revision: state.engine.currentRevision,
    reviewCount: reviews.length,
    latestRound,
    maxRounds: 3,
    openObservations: open,
    openBlockingObservations: openBlocking,
    auditPassed: audit?.passed ?? null,
    decision
  };
  await writeJsonAtomic(join(rootPath, state.paths.reports, `review-loop-${String(state.engine.currentRevision).padStart(6, "0")}.json`), result);
  return result;
}

export async function applyReviewPatch(root, input, options = {}) {
  const rootPath = resolve(root);
  const state = await loadWorkflowProject(rootPath);
  assertMutableProject(state.meta);
  const reviews = await loadReviews(rootPath, state.paths);
  const review = reviews.find((item) => item.reviewId === input.reviewId);
  if (!review) throw new CutKitError("REVIEW_NOT_FOUND", "Patch must reference a stored review", { reviewId: input.reviewId });
  const patchId = input.patchId ?? newId("patch");
  const envelope = {
    schemaVersion: 1,
    baseRevision: input.baseRevision ?? state.engine.currentRevision,
    actor: input.actor ?? "human:editor",
    operationId: input.operationId,
    causeId: input.reviewId,
    reviewId: input.reviewId,
    patchId,
    operations: input.operations
  };
  if (state.meta.state === "REVIEW_REQUIRED") await transitionInternal(rootPath, "REVISING", { actor: envelope.actor, causeId: input.reviewId, reason: "review patch started" });
  const result = state.engine.commit(envelope);
  await persistEngine(rootPath, state.meta, state.engine, result);
  const patchRecord = {
    schemaVersion: 1,
    patchId,
    reviewId: input.reviewId,
    actor: envelope.actor,
    baseRevision: envelope.baseRevision,
    resultRevision: result.revision,
    operations: envelope.operations,
    changedPaths: result.changedPaths,
    createdAt: nowValue()
  };
  const patchPath = join(rootPath, state.paths.patches, `${String(result.revision).padStart(6, "0")}-${patchId}.json`);
  await writeJsonAtomic(patchPath, patchRecord);
  await appendJsonLine(join(rootPath, state.paths.reports, "review-resolutions.jsonl"), {
    patchId,
    reviewId: input.reviewId,
    fromRevision: envelope.baseRevision,
    toRevision: result.revision,
    observationIds: input.observationIds ?? review.observations.map((observation) => observation.observationId),
    actor: envelope.actor,
    at: nowValue()
  });
  await updateManifest(rootPath, (value) => ({
    ...value,
    timelineRevision: result.revision,
    currentTimeline: `history/${String(result.revision).padStart(6, "0")}.json`
  }));
  await writeEvent(rootPath, state.meta, {
    event: "timeline.review_patch_applied",
    actor: envelope.actor,
    causeId: input.reviewId,
    patchId,
    fromRevision: envelope.baseRevision,
    toRevision: result.revision
  });
  return { result, patchRecord, patchPath };
}

export async function evaluateForgeRequestGate(root, request, options = {}) {
  const rootPath = resolve(root);
  const state = await loadWorkflowProject(rootPath);
  assertMutableProject(state.meta);
  validateForgeRequest(request);
  const analysis = options.gaps ?? await analyzeProjectGaps(rootPath, { actor: options.actor });
  const gate = evaluateForgeGate({
    gaps: analysis.gaps,
    intent: state.intent,
    project: state.meta,
    request,
    artifact: options.artifact ?? null,
    timeline: state.engine.document,
    assets: state.assets
  });
  await writeJsonAtomic(join(rootPath, state.paths.forge, `${request.requestId}.json`), {
    request,
    decision: gate,
    evaluatedAt: nowValue()
  });
  await writeEvent(rootPath, state.meta, {
    event: "forge.gate.evaluated",
    actor: options.actor ?? "system",
    causeId: request.requestId,
    gapId: request.gapId,
    decision: gate.decision
  });
  return gate;
}

export function toRenderMediaAssets(assets) {
  return Object.fromEntries(Object.entries(assets).map(([assetId, asset]) => [assetId, {
    schemaVersion: 1,
    assetId,
    sourceUri: asset.uri,
    sourceHash: asset.contentHash,
    mediaKind: asset.media?.hasAudio && asset.media.width === 0 ? "audio" : "video",
    durationMs: asset.media?.durationMs ?? 0,
    width: asset.media?.width ?? 0,
    height: asset.media?.height ?? 0,
    fps: asset.media?.fps ?? 30,
    hasAudio: asset.media?.hasAudio ?? false,
    colorProfile: asset.provenance?.colorProfile ?? "unknown",
    provenance: asset.provenance
  }]));
}

export async function buildProjectRenderPlan(root, options = {}) {
  const rootPath = resolve(root);
  const state = await loadWorkflowProject(rootPath);
  assertMutableProject(state.meta);
  const profile = typeof options.profile === "object"
    ? options.profile
    : options.profile === "final" ? FINAL_PROFILE : PREVIEW_PROFILE;
  const plan = buildRenderPlan({
    timeline: state.engine.document,
    assets: toRenderMediaAssets(state.assets),
    profile,
    environment: options.environment ?? {
      node: process.version,
      platform: process.platform,
      arch: process.arch
    }
  });
  const outputPath = options.output
    ? resolve(options.output)
    : join(rootPath, state.paths.renders, String(plan.revision).padStart(6, "0"), `${profile.profileId}-plan.json`);
  await writeJsonAtomic(outputPath, plan);
  await writeEvent(rootPath, state.meta, {
    event: "render.plan.built",
    actor: options.actor ?? "system",
    revision: plan.revision,
    planId: plan.planId,
    renderHash: plan.renderHash,
    output: outputPath
  });
  return { plan, outputPath };
}
export async function completeProjectRender(root, options = {}) {
  const rootPath = resolve(root);
  const state = await loadWorkflowProject(rootPath);
  assertMutableProject(state.meta);
  if (!options.output) throw new CutKitError("RENDER_OUTPUT_REQUIRED", "Render completion requires an output file");
  const outputPath = resolve(options.output);
  if (!(await exists(outputPath))) throw new CutKitError("RENDER_OUTPUT_MISSING", "Rendered output does not exist", { outputPath });
  const completion = {
    schemaVersion: 1,
    revision: state.engine.currentRevision,
    output: outputPath,
    renderHash: options.renderHash ?? null,
    completedAt: nowValue(),
    completedBy: options.actor ?? "system"
  };
  await writeJsonAtomic(join(rootPath, state.paths.renders, `${String(state.engine.currentRevision).padStart(6, "0")}`, "completion.json"), completion);
  await updateManifest(rootPath, (value) => ({ ...value, lastRender: outputPath }));
  const current = (await readJson(join(rootPath, "project.json"))).state;
  const sequence = current === "MATERIAL_CHECK"
    ? ["BUILDING", "RENDERING", "REVIEW_REQUIRED"]
    : current === "BUILDING"
      ? ["RENDERING", "REVIEW_REQUIRED"]
      : current === "RENDERING" || current === "REVISING"
        ? ["REVIEW_REQUIRED"]
        : [];
  for (const target of sequence) {
    await transitionInternal(rootPath, target, { actor: completion.completedBy, reason: "render output recorded" });
  }
  await writeEvent(rootPath, state.meta, {
    event: "render.completed",
    actor: completion.completedBy,
    revision: completion.revision,
    output: outputPath,
    renderHash: completion.renderHash
  });
  return completion;
}
export async function approveProject(root, options = {}) {
  const rootPath = resolve(root);
  const state = await loadWorkflowProject(rootPath);
  const loop = await reviewLoopStatus(rootPath);
  const auditPath = state.meta.lastAudit ? join(rootPath, state.meta.lastAudit) : null;
  const audit = auditPath && await exists(auditPath) ? await readJson(auditPath) : null;
  if (loop.decision !== "READY_FOR_APPROVAL" || !audit?.passed) {
    throw new CutKitError("APPROVAL_BLOCKED", "Project is not ready for approval", { reviewLoop: loop, auditPassed: audit?.passed ?? false });
  }
  const approval = {
    schemaVersion: 1,
    approvalId: newId("approval"),
    projectId: state.meta.projectId,
    revision: state.engine.currentRevision,
    actor: options.actor ?? "human:approver",
    scope: options.scope ?? "timeline-and-release",
    at: nowValue()
  };
  if (state.meta.state !== "READY_FOR_APPROVAL") await transitionInternal(rootPath, "READY_FOR_APPROVAL", { actor: approval.actor, reason: "review loop reached an approvable state" });
  await appendJsonLine(join(rootPath, "history", "approvals.jsonl"), approval);
  await transitionInternal(rootPath, "APPROVED", { actor: approval.actor, causeId: approval.approvalId, reason: "release approved" });
  return approval;
}

export async function finalizeProject(root, options = {}) {
  const rootPath = resolve(root);
  const state = await loadWorkflowProject(rootPath);
  if (state.meta.state !== "APPROVED") throw new CutKitError("FINALIZE_NOT_APPROVED", "Only approved projects can be finalized", { state: state.meta.state });
  const auditPath = state.meta.lastAudit ? join(rootPath, state.meta.lastAudit) : null;
  const audit = auditPath && await exists(auditPath) ? await readJson(auditPath) : null;
  if (!audit?.passed) throw new CutKitError("FINALIZE_AUDIT_FAILED", "Finalization requires a passing audit");
  const approvalText = await readFile(join(rootPath, "history", "approvals.jsonl"), "utf8");
  const approvals = approvalText.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)).filter((item) => item.approvalId);
  const assetHashes = Object.fromEntries(Object.entries(state.assets).map(([assetId, asset]) => [assetId, asset.contentHash]));
  const manifest = {
    schemaVersion: 1,
    projectId: state.meta.projectId,
    timelineId: state.engine.document.timelineId,
    revision: state.engine.currentRevision,
    timelineHash: state.engine.document.timelineHash ?? contentHash(state.engine.document),
    assetHashes,
    approvals,
    renderedFile: options.renderedFile ?? state.meta.lastRender,
    finalizedAt: nowValue(),
    finalizedBy: options.actor ?? "human:producer"
  };
  manifest.manifestHash = contentHash({ ...manifest });
  const manifestPath = join(rootPath, state.paths.final, "manifest.json");
  await writeJsonAtomic(manifestPath, manifest);
  await transitionInternal(rootPath, "FINALIZED", { actor: manifest.finalizedBy, causeId: manifest.manifestHash, reason: "final manifest written" });
  return { manifest, manifestPath };
}

export async function workflowStatus(root) {
  const state = await loadWorkflowProject(root);
  const gapPath = join(state.root, state.paths.gaps, `analysis-${String(state.engine.currentRevision).padStart(6, "0")}.json`);
  const gaps = await readOptionalJson(gapPath, { revision: state.engine.currentRevision, gaps: [], blockingCount: 0 });
  const audit = state.meta.lastAudit ? await readOptionalJson(join(state.root, state.meta.lastAudit), null) : null;
  const loop = await reviewLoopStatus(state.root);
  return {
    project: state.meta,
    timelineRevision: state.engine.currentRevision,
    assetCount: Object.keys(state.assets).length,
    candidateCount: state.candidates.length,
    gapCount: gaps.gaps.length,
    blockingGapCount: gaps.blockingCount,
    audit,
    reviewLoop: loop,
    screenTime: calculateScreenTime(state.engine.document, state.assets)
  };
}

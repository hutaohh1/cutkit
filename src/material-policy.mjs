import { CutKitError, SchemaValidationError } from "./errors.mjs";
import { validateForgeRequest, validateIntent, FACTUAL_ROLE_NAMES } from "./workflow-schema.mjs";

const SUPPORT_RENDER_ROLES = new Set(["black", "logo", "caption", "subtitle", "lower_third"]);

function visualWeight(clip) {
  const layout = clip.layout ?? { x: 0, y: 0, width: 1, height: 1 };
  const area = Math.max(0, Math.min(1, layout.width)) * Math.max(0, Math.min(1, layout.height));
  const duration = Math.max(0, clip.timelineEndMs - clip.timelineStartMs);
  return duration * area * Math.max(0, Math.min(1, clip.opacity));
}

function bucketForAsset(asset) {
  if (asset?.kind === "SYNTHETIC_PROCEDURAL") return "procedural";
  if (asset?.kind === "SYNTHETIC_GENERATED") return "generated";
  if (asset?.kind === "REAL") return "real";
  return "unclassified";
}

export function calculateScreenTime(timeline, assets = {}) {
  const buckets = {
    realEffectiveMs: 0,
    proceduralEffectiveMs: 0,
    generatedEffectiveMs: 0,
    unclassifiedEffectiveMs: 0,
    supportingEffectiveMs: 0
  };
  const byAsset = {};
  for (const clip of timeline.clips ?? []) {
    if (clip.kind === "audio" || clip.kind === "caption") continue;
    const weight = visualWeight(clip);
    if (SUPPORT_RENDER_ROLES.has(clip.renderRole)) {
      buckets.supportingEffectiveMs += weight;
      continue;
    }
    const bucket = bucketForAsset(assets[clip.assetId]);
    const key = `${bucket}EffectiveMs`;
    buckets[key] += weight;
    byAsset[clip.assetId] = (byAsset[clip.assetId] ?? 0) + weight;
  }
  const narrativeEffectiveMs = buckets.realEffectiveMs + buckets.proceduralEffectiveMs + buckets.generatedEffectiveMs + buckets.unclassifiedEffectiveMs;
  const percent = (value) => narrativeEffectiveMs > 0 ? value / narrativeEffectiveMs * 100 : 0;
  return {
    ...buckets,
    narrativeEffectiveMs,
    totalEffectiveMs: narrativeEffectiveMs + buckets.supportingEffectiveMs,
    realPercent: percent(buckets.realEffectiveMs),
    proceduralPercent: percent(buckets.proceduralEffectiveMs),
    generatedPercent: percent(buckets.generatedEffectiveMs),
    unclassifiedPercent: percent(buckets.unclassifiedEffectiveMs),
    syntheticPercent: percent(buckets.proceduralEffectiveMs + buckets.generatedEffectiveMs),
    byAssetEffectiveMs: byAsset
  };
}

export function evaluateMaterialPolicy({ timeline, assets = {}, intent }) {
  validateIntent(intent);
  const metrics = calculateScreenTime(timeline, assets);
  const policy = intent.materialPolicy;
  const checks = [];
  const check = (code, passed, message, actual, limit) => checks.push({
    code,
    status: passed ? "pass" : "fail",
    message,
    actual: Number(actual.toFixed(4)),
    limit
  });
  check("MIN_REAL_SCREEN_TIME", metrics.realPercent + 1e-9 >= policy.minRealScreenTimePercent,
    "Real footage meets the minimum effective screen time", metrics.realPercent, `>= ${policy.minRealScreenTimePercent}`);
  check("MAX_PROCEDURAL_SCREEN_TIME", metrics.proceduralPercent <= policy.maxProceduralScreenTimePercent + 1e-9,
    "Procedural material is within its effective screen-time limit", metrics.proceduralPercent, `<= ${policy.maxProceduralScreenTimePercent}`);
  check("MAX_GENERATED_SCREEN_TIME", metrics.generatedPercent <= policy.maxGeneratedScreenTimePercent + 1e-9,
    "Generated material is within its effective screen-time limit", metrics.generatedPercent, `<= ${policy.maxGeneratedScreenTimePercent}`);
  check("MAX_SYNTHETIC_TOTAL", metrics.syntheticPercent <= policy.maxSyntheticTotalPercent + 1e-9,
    "Synthetic material is within its combined effective screen-time limit", metrics.syntheticPercent, `<= ${policy.maxSyntheticTotalPercent}`);
  if (metrics.unclassifiedEffectiveMs > 0) checks.push({
    code: "UNCLASSIFIED_MATERIAL",
    status: "fail",
    message: "Every visual clip must map to a registered asset",
    actual: metrics.unclassifiedPercent,
    limit: 0
  });
  const hardFailures = checks.filter((item) => item.status === "fail");
  const canOverride = policy.allowSyntheticAboveLimit && hardFailures.every((item) => item.code.startsWith("MAX_"));
  return {
    ok: hardFailures.length === 0,
    canOverride,
    overrideAllowedByPolicy: policy.allowSyntheticAboveLimit,
    metrics,
    checks
  };
}

function requiredProvenanceForRequest(request) {
  return request.forge === "FORGE_B_GENERATIVE"
    ? ["method", "tool", "model", "modelVersion", "prompt", "negativePrompt", "inputRefs", "parameters"]
    : ["method", "tool", "recipeHash", "parameters"];
}

export function evaluateForgeGate({ gap, gaps = [], intent, project = {}, request, artifact = null, timeline = null, assets = {} }) {
  validateForgeRequest(request);
  validateIntent(intent);
  const resolvedGap = gap ?? gaps.find((item) => item.gapId === request.gapId);
  const gate1 = { passed: true, code: "FORGE_SEMANTIC_GATE_PASSED", checks: [] };
  const add = (passed, code, message) => {
    gate1.checks.push({ code, status: passed ? "pass" : "fail", message });
    if (!passed) {
      gate1.passed = false;
      if (gate1.code === "FORGE_SEMANTIC_GATE_PASSED") gate1.code = code;
    }
  };
  add(Boolean(resolvedGap), "GAP_NOT_FOUND", "Forge requests must reference a diagnosed gap");
  if (resolvedGap) {
    add(["AUXILIARY_ALLOWED", "HUMAN_REVIEW"].includes(resolvedGap.policy), "MISSING_REAL", "Real-only gaps cannot be replaced with synthetic material");
    add(!resolvedGap.blocking || resolvedGap.policy === "AUXILIARY_ALLOWED", "FORGE_FORBIDDEN", "Blocking gaps require real material unless policy explicitly allows auxiliary material");
  }
  add(!FACTUAL_ROLE_NAMES.has(request.requestedRole), "FACTUAL_ROLE_FORBIDDEN", "Synthetic material cannot assume factual roles");
  add(!intent.avoid.some((rule) => rule.type === "synthetic_person" && (rule.value === "*" || rule.value === request.requestedRole)),
    "INTENT_MATERIAL_FORBIDDEN", "Intent policy forbids this synthetic role");
  if (request.forge === "FORGE_B_GENERATIVE") {
    add(Boolean(project.forgeBEnabled), "FORGE_B_DISABLED", "Forge-B is disabled by default");
    add(Boolean(request.approvedBy), "FORGE_B_APPROVAL_REQUIRED", "Forge-B requires explicit named approval");
  }

  const gate2 = { passed: true, code: "FORGE_ARTIFACT_GATE_PASSED", checks: [] };
  if (artifact) {
    const addArtifact = (passed, code, message) => {
      gate2.checks.push({ code, status: passed ? "pass" : "fail", message });
      if (!passed) {
        gate2.passed = false;
        if (gate2.code === "FORGE_ARTIFACT_GATE_PASSED") gate2.code = code;
      }
    };
    addArtifact(artifact.durationMs === request.durationMs, "FORGE_DURATION_MISMATCH", "Artifact duration must exactly match the approved request");
    addArtifact(Number.isInteger(artifact.width) && artifact.width > 0 && Number.isInteger(artifact.height) && artifact.height > 0,
      "FORGE_RESOLUTION_INVALID", "Artifact resolution must be positive");
    addArtifact(typeof artifact.fps === "number" && artifact.fps > 0, "FORGE_FPS_INVALID", "Artifact frame rate must be positive");
    if (project.resolution) addArtifact(artifact.width === project.resolution[0] && artifact.height === project.resolution[1],
      "FORGE_RESOLUTION_MISMATCH", "Artifact resolution must match the project");
    if (project.fps) addArtifact(Math.abs(artifact.fps - project.fps) < 1e-6, "FORGE_FPS_MISMATCH", "Artifact frame rate must match the project");
    const provenance = artifact.provenance ?? {};
    const missing = requiredProvenanceForRequest(request).filter((field) => provenance[field] === undefined || provenance[field] === null || provenance[field] === "");
    addArtifact(missing.length === 0, "FORGE_PROVENANCE_INCOMPLETE", `Missing provenance fields: ${missing.join(", ") || "none"}`);
    addArtifact(typeof artifact.contentHash === "string" && artifact.contentHash.startsWith("sha256:"), "FORGE_OUTPUT_HASH_MISSING", "Artifact must carry its output content hash");
    addArtifact(Boolean(artifact.visualQc?.passed), "FORGE_VISUAL_QC_FAILED", "Artifact visual QC must pass");
    if (timeline && intent) {
      const policy = evaluateMaterialPolicy({ timeline, assets, intent });
      addArtifact(policy.ok || policy.canOverride, "MATERIAL_POLICY_EXCEEDED", "Artifact would exceed the project material policy");
    }
  }

  return {
    ok: gate1.passed && gate2.passed,
    decision: gate1.passed && gate2.passed ? "ALLOW" : "BLOCK",
    gate1,
    gate2
  };
}

export function assertForgeGate(input) {
  const result = evaluateForgeGate(input);
  if (!result.ok) throw new CutKitError(result.gate1.passed ? result.gate2.code : result.gate1.code, "Material Forge request was blocked", result);
  return result;
}

export function assertMaterialPolicy(input) {
  const result = evaluateMaterialPolicy(input);
  if (!result.ok && !result.canOverride) {
    throw new CutKitError("MATERIAL_POLICY_VIOLATION", "Timeline exceeds the declared material policy", result);
  }
  return result;
}

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newId } from "../src/id.mjs";
import {
  analyzeProjectGaps,
  applyReviewPatch,
  approveProject,
  auditProject,
  buildProjectRenderPlan,
  commitTimelineDraft,
  compileTimelineFromCandidates,
  completeProjectRender,
  createWorkflowProject,
  evaluateForgeRequestGate,
  finalizeProject,
  registerProjectAssets,
  registerProjectCandidates,
  submitProjectReview,
  workflowStatus
} from "../src/workflow.mjs";

function realAsset() {
  const assetId = newId("asset");
  return {
    assetId,
    kind: "REAL",
    synthetic: false,
    uri: "sources/interview.mp4",
    contentHash: `sha256:${"1".repeat(64)}`,
    roles: ["founder_interview"],
    allowedRoles: [],
    prohibitedRoles: [],
    media: { durationMs: 20000, fps: 30, width: 1920, height: 1080, hasAudio: true },
    rights: { status: "cleared", license: "internal", consentRefs: ["consent_founder"] },
    provenance: { source: "camera_card", ingestedAt: "2026-09-25T10:00:00+08:00" }
  };
}

function proceduralAsset() {
  const assetId = newId("asset");
  return {
    assetId,
    kind: "SYNTHETIC_PROCEDURAL",
    synthetic: true,
    uri: "cache/forge/particles.webm",
    contentHash: `sha256:${"2".repeat(64)}`,
    roles: ["transition"],
    allowedRoles: ["transition", "graphic_texture"],
    prohibitedRoles: ["person", "place", "product", "evidence", "testimony", "event", "identity"],
    media: { durationMs: 5000, fps: 30, width: 1920, height: 1080, hasAudio: false },
    rights: { status: "cleared", license: "project-generated", consentRefs: [] },
    provenance: {
      source: "material_forge",
      ingestedAt: "2026-09-25T10:00:00+08:00",
      method: "procedural",
      tool: "cutkit-forge-a",
      recipeHash: `sha256:${"3".repeat(64)}`,
      parameters: { seed: 731922, durationMs: 2000 }
    }
  };
}

function intent() {
  return {
    schemaVersion: 1,
    targetDurationMs: 10000,
    durationToleranceMs: 500,
    aspectRatio: "16:9",
    style: { tone: "documentary", pacing: "measured", visualTreatment: "natural" },
    structureTemplate: "hook_body_end",
    mustInclude: [
      { id: "mi_founder", type: "shot_role", value: "founder_interview", blocking: true },
      { id: "mi_transition", type: "tag", value: "particles", blocking: true }
    ],
    avoid: [],
    materialPolicy: {
      minRealScreenTimePercent: 80,
      maxProceduralScreenTimePercent: 25,
      maxGeneratedScreenTimePercent: 0,
      maxSyntheticTotalPercent: 30,
      allowSyntheticAboveLimit: false
    },
    seed: 731922
  };
}

test("workflow compiles, audits, reviews, approves, and finalizes an immutable project", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "cutkit-workflow-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const real = realAsset();
  const procedural = proceduralAsset();

  await createWorkflowProject(root, { intent: intent(), actor: "human:producer" });
  await registerProjectAssets(root, [real, procedural], { actor: "human:ingest" });
  await registerProjectCandidates(root, [
    {
      candidateId: "cand_founder_001",
      assetId: real.assetId,
      sourceInMs: 0,
      sourceOutMs: 12000,
      recommendedInMs: 1000,
      recommendedOutMs: 9000,
      roles: ["founder_interview"],
      tags: ["interview"],
      scores: { technical: 0.95, relevance: 0.98, continuity: 0.9, safety: 1 },
      qualityFlags: [],
      confidence: 0.96
    },
    {
      candidateId: "cand_particles_001",
      assetId: procedural.assetId,
      sourceInMs: 0,
      sourceOutMs: 3000,
      recommendedInMs: 500,
      recommendedOutMs: 2500,
      roles: ["transition"],
      tags: ["particles"],
      scores: { technical: 0.9, relevance: 0.92, continuity: 0.85, safety: 1 },
      qualityFlags: [],
      confidence: 0.93
    }
  ], { actor: "human:indexer" });

  const compiled = await compileTimelineFromCandidates(root, { actor: "human:editor" });
  assert.equal(compiled.timeline.durationMs, 10000);
  assert.deepEqual(compiled.candidateIds, ["cand_founder_001", "cand_particles_001"]);
  const committed = await commitTimelineDraft(root, { actor: "human:editor", draftPath: compiled.outputPath });
  assert.equal(committed.revision, 1);

  const projectPlan = await buildProjectRenderPlan(root, { actor: "system", profile: "preview" });
  assert.equal(projectPlan.plan.inputs.length, 2);
  assert.equal(projectPlan.plan.renderGraph.assets[real.assetId].sourceHash, real.contentHash);
  const firstAudit = await auditProject(root, { actor: "system" });
  assert.equal(firstAudit.report.passed, true, JSON.stringify(firstAudit.report.checks, null, 2));
  const output = join(root, "preview.mp4");
  await writeFile(output, "test-render");
  await completeProjectRender(root, { output, renderHash: "sha256:render", actor: "human:renderer" });

  await submitProjectReview(root, {
    reviewId: "review_round_1",
    revision: 1,
    round: 1,
    actor: "human:reviewer",
    createdAt: "2026-09-25T11:00:00+08:00",
    dimensions: ["pacing"],
    observations: [{
      observationId: "obs_pacing_001",
      dimension: "pacing",
      severity: "blocking",
      clipId: compiled.timeline.clips[0].clipId,
      issue: "Opening role label is missing",
      suggestedChange: "Update the render role label"
    }],
    summary: "One blocking presentation issue"
  }, { actor: "human:reviewer" });

  const patch = await applyReviewPatch(root, {
    reviewId: "review_round_1",
    actor: "human:editor",
    baseRevision: 1,
    operations: [{ op: "replace", path: "/clips/0/renderRole", value: "founder_interview_opening" }],
    observationIds: ["obs_pacing_001"]
  });
  assert.equal(patch.result.revision, 2);

  const secondAudit = await auditProject(root, { actor: "system" });
  assert.equal(secondAudit.report.passed, true);
  await submitProjectReview(root, {
    reviewId: "review_round_2",
    revision: 2,
    round: 2,
    actor: "human:reviewer",
    createdAt: "2026-09-25T11:05:00+08:00",
    dimensions: ["pacing"],
    observations: [],
    summary: "All blocking issues resolved"
  });

  const approval = await approveProject(root, { actor: "human:approver" });
  assert.equal(approval.revision, 2);
  const finalized = await finalizeProject(root, { actor: "human:producer", renderedFile: output });
  assert.equal(finalized.manifest.revision, 2);
  const status = await workflowStatus(root);
  assert.equal(status.project.state, "FINALIZED");
  assert.equal(status.audit.passed, true);
});

test("missing factual evidence stays MISSING_REAL and blocks Material Forge", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "cutkit-gap-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const real = realAsset();
  const projectIntent = intent();
  projectIntent.targetDurationMs = 8000;
  projectIntent.durationToleranceMs = 0;
  projectIntent.mustInclude = [
    { id: "mi_founder", type: "shot_role", value: "founder_interview", blocking: true },
    { id: "mi_launch_fact", type: "fact", value: "launch_date", blocking: true }
  ];
  await createWorkflowProject(root, { intent: projectIntent });
  await registerProjectAssets(root, [real]);
  await registerProjectCandidates(root, [{
    candidateId: "cand_founder_001",
    assetId: real.assetId,
    sourceInMs: 0,
    sourceOutMs: 12000,
    recommendedInMs: 1000,
    recommendedOutMs: 9000,
    roles: ["founder_interview"],
    tags: ["interview"],
    scores: { technical: 0.95, relevance: 0.98, continuity: 0.9, safety: 1 },
    qualityFlags: [],
    confidence: 0.96
  }]);
  const compiled = await compileTimelineFromCandidates(root, {});
  await commitTimelineDraft(root, { draftPath: compiled.outputPath });
  const analysis = await analyzeProjectGaps(root, {});
  const missing = analysis.gaps.find((gap) => gap.mustIncludeRef === "mi_launch_fact");
  assert.equal(missing.kind, "MISSING_REAL");
  assert.equal(missing.policy, "REAL_REQUIRED");

  const gate = await evaluateForgeRequestGate(root, {
    schemaVersion: 1,
    requestId: "forge_request_001",
    gapId: missing.gapId,
    forge: "FORGE_A_PROCEDURAL",
    requestedRole: "transition",
    durationMs: 1000,
    parameters: { seed: 1 },
    approvedBy: null
  }, { gaps: analysis });
  assert.equal(gate.ok, false);
  assert.equal(gate.gate1.code, "MISSING_REAL");
});

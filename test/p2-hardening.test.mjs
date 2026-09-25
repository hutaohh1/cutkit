import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { newId } from "../src/id.mjs";
import { buildRenderPlan, createRenderManifest, PREVIEW_PROFILE } from "../src/render-plan.mjs";
import { evaluateAudioQc } from "../src/audio-qc.mjs";
import { buildAss } from "../src/captions.mjs";
import { assertTimelineCapabilities, createCapability, validateCapabilityRegistry } from "../src/capability-registry.mjs";
import { assertReleaseGate } from "../src/release-gate.mjs";
import { createProvenanceManifest } from "../src/provenance.mjs";
import { signC2paAsset } from "../src/c2pa.mjs";
import { createHandoff, reimportHandoff } from "../src/editor-handoff.mjs";
import { RevisionEngine } from "../src/revisions.mjs";

function timelineFixture(overrides = {}) {
  const trackId = newId("track");
  const assetId = newId("asset");
  return {
    timeline: {
      schemaVersion: 1,
      timelineId: newId("timeline"),
      revision: 0,
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
        opacity: 1,
        ...(overrides.clip ?? {})
      }]
    },
    asset: {
      schemaVersion: 1,
      assetId,
      sourceUri: "C:/media/source.mp4",
      sourceHash: "sha256:abc",
      mediaKind: "video",
      durationMs: 1000,
      width: 1920,
      height: 1080,
      fps: 30,
      hasAudio: true,
      colorProfile: "bt709",
      provenance: { kind: "real" }
    }
  };
}

test("render manifest separates planned hash from executable environment hash", () => {
  const { timeline, asset } = timelineFixture();
  const plan = buildRenderPlan({ timeline, assets: { [asset.assetId]: asset }, profile: PREVIEW_PROFILE, environment: { os: "a" } });
  const first = createRenderManifest(plan, { environment: { os: "a" }, commandArgs: ["-i", "in.mp4"] });
  const second = createRenderManifest(plan, { environment: { os: "a" }, commandArgs: ["-i", "in.mp4"] });
  const changed = createRenderManifest(plan, { environment: { os: "b" }, commandArgs: ["-i", "in.mp4"] });
  assert.equal(first.plannedRenderHash, plan.renderHash);
  assert.equal(first.renderHash, second.renderHash);
  assert.notEqual(first.renderHash, changed.renderHash);
});

test("audio QC reports unknown clipping and overlap as warnings", () => {
  const report = evaluateAudioQc({
    integratedLufs: -16,
    truePeakDbtp: -2,
    clippingPercent: null,
    silencePercent: 0,
    dialogueMusicOverlapPercent: null
  });
  assert.equal(report.passed, true);
  assert.equal(report.checks.find((check) => check.code === "CLIPPING").status, "warn");
  assert.equal(report.checks.find((check) => check.code === "DUCKING_OVERLAP").status, "warn");
});

test("ASS output respects render profile dimensions", () => {
  const cue = {
    cueId: newId("cue"),
    textId: newId("text"),
    role: "dialogue",
    startMs: 0,
    endMs: 1000,
    content: "Hello",
    fontRole: "dialogue",
    lineBreakPolicy: "balance"
  };
  const ass = buildAss([cue], { playResX: 960, playResY: 540 });
  assert.match(ass, /PlayResX: 960/);
  assert.match(ass, /PlayResY: 540/);
});

test("release gate blocks missing rights", () => {
  const asset = timelineFixture().asset;
  const manifest = createProvenanceManifest({ asset });
  assert.throws(() => assertReleaseGate({ asset, manifest, rights: [], consents: [] }), (error) => error.code === "RELEASE_POLICY_BLOCKED");
});

test("C2PA signing blocks mismatched asset hashes", async () => {
  const certificate = await readFile("D:/项目3/test/fixtures/certs/es256.pub", "utf8");
  const privateKey = await readFile("D:/项目3/test/fixtures/certs/es256.pem", "utf8");
  const asset = { assetId: newId("asset"), sourceHash: "sha256:not-the-file" };
  const manifest = createProvenanceManifest({ asset });
  await assert.rejects(() => signC2paAsset({
    inputPath: "D:/项目3/package.json",
    outputPath: "D:/项目3/.tmp/should-not-exist.jpg",
    provenanceManifest: manifest,
    certificate,
    privateKey,
    mimeType: "image/jpeg",
    releasePolicy: { required: false }
  }), (error) => error.code === "C2PA_ASSET_HASH_MISMATCH");
});

test("lossy external editor round-trip is blocked by default", () => {
  const { timeline, asset } = timelineFixture({ clip: { speed: 2, sourceOutMs: 500 } });
  const assets = { [asset.assetId]: asset };
  const handoff = createHandoff({ timeline, assets, format: "edl", actor: "editor", options: { fps: 30 } });
  const engine = new RevisionEngine(timeline);
  assert.throws(() => reimportHandoff({ ...handoff, engine, actor: "editor", assets, options: { fps: 30, assetIdByName: { "source.mp4": asset.assetId } } }), (error) => error.code === "HANDOFF_LOSS_NOT_ALLOWED");
});

test("capability registry blocks unverified timeline effects", () => {
  const capabilityId = newId("capability");
  const registry = {
    [capabilityId]: createCapability({
      capabilityId,
      kind: "effect",
      status: "verified",
      implementation: "ffmpeg:gblur",
      renderer: "ffmpeg",
      version: "1.0.0",
      timeContract: "source_range",
      fallback: null,
      testVectors: ["tests/gblur"]
    })
  };
  const { timeline } = timelineFixture({ clip: { effects: [{ capabilityId, type: "blur" }] } });
  assert.equal(assertTimelineCapabilities(timeline, registry).ok, true);
  registry[capabilityId].status = "documented";
  assert.throws(() => assertTimelineCapabilities(timeline, registry), (error) => error.code === "CAPABILITY_NOT_VERIFIED");
  assert.equal(validateCapabilityRegistry(registry), true);
});
